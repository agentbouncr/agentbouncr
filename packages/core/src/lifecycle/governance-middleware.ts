/**
 * @agentbouncr/core — GovernanceMiddleware
 *
 * Main entry point for developers.
 * Orchestrates PolicyEngine, EventEmitter, KillSwitch, and DatabaseAdapter.
 *
 * Usage:
 *   const governance = new GovernanceMiddleware();
 *   const result = await governance.evaluate({ agentId: 'a', tool: 'x', params: {} });
 *
 * Zero-Config: Works without policy — defaults allow-all, logs all.
 * Kill-Switch: emergencyStop() denies ALL evaluate() calls.
 * Agent CRUD: registerAgent/start/stop/delete — requires DatabaseAdapter.
 */

import pino from 'pino';
import type {
  DatabaseAdapter,
  EvaluateRequest,
  EvaluateResult,
  Policy,
  PolicyVersion,
  AgentConfig,
  AgentStatus,
  ApprovalRequest,
  ApprovalFilter,
  ApprovalResolution,
} from '../types/index.js';
import type { KillSwitchStatus } from './kill-switch.js';
import { GovernanceError } from '../types/index.js';
import { PolicyEngine } from '../core/policy-engine.js';
import {
  GovernanceEventEmitter,
  type GovernanceEventType,
  type GovernanceEventListener,
} from '../events/event-emitter.js';
import { KillSwitchManager } from './kill-switch.js';
import { generateTraceId } from '../tracing/trace-context.js';
import { policySchema } from '../core/policy-schema.js';
import { evaluateRequestSchema, agentConfigSchema } from './middleware-schemas.js';

// --- Options ---

export interface GovernanceMiddlewareOptions {
  db?: DatabaseAdapter;
  policy?: Policy;
  logger?: pino.Logger;
  approvalTimeoutSeconds?: number;
}

/** Default: 1 hour */
const DEFAULT_APPROVAL_TIMEOUT_SECONDS = 3600;

// --- Default allow-all policy ---

function defaultAllowAllPolicy(): Policy {
  return {
    name: 'default-allow-all',
    version: '1.0',
    rules: [{ tool: '*', effect: 'allow' as const }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// --- GovernanceMiddleware ---

export class GovernanceMiddleware {
  private readonly logger: pino.Logger;
  private readonly eventEmitter: GovernanceEventEmitter;
  private readonly policyEngine: PolicyEngine;
  private readonly killSwitch: KillSwitchManager;
  private readonly db?: DatabaseAdapter;
  private readonly approvalTimeoutSeconds: number;
  private readonly tenantId?: string;
  private policy: Policy | null;

  constructor(options?: GovernanceMiddlewareOptions) {
    this.logger = options?.logger ?? pino({ level: 'info' });
    this.eventEmitter = new GovernanceEventEmitter(this.logger);
    this.policyEngine = new PolicyEngine(this.logger);
    this.killSwitch = new KillSwitchManager(this.logger, this.eventEmitter);
    this.db = options?.db;
    this.policy = options?.policy ?? null;
    this.approvalTimeoutSeconds = options?.approvalTimeoutSeconds ?? DEFAULT_APPROVAL_TIMEOUT_SECONDS;
  }

  // --- Multi-Tenant ---

  /**
   * Return a tenant-scoped middleware sharing EventEmitter, PolicyEngine, KillSwitch.
   * Only the DatabaseAdapter is scoped to the given tenantId.
   */
  forTenant(tenantId: string): GovernanceMiddleware {
    if (!this.db?.forTenant) return this;
    const scopedDb = this.db.forTenant(tenantId);
    if (scopedDb === this.db) return this;
    const scoped = Object.create(this) as GovernanceMiddleware;
    Object.defineProperty(scoped, 'db', { value: scopedDb });
    Object.defineProperty(scoped, 'tenantId', { value: tenantId });
    return scoped;
  }

  // --- Evaluate ---

  /**
   * Evaluate a tool-call request against governance policies.
   *
   * Flow:
   * 1. Kill-Switch check (immediate deny if active)
   * 2. Policy resolution: inline > DB > default allow-all
   * 3. PolicyEngine.evaluate()
   * 4. Event emission (tool_call.allowed / tool_call.denied)
   */
  async evaluate(request: EvaluateRequest): Promise<EvaluateResult> {
    // 0. Input validation
    try {
      evaluateRequestSchema.parse(request);
    } catch (err) {
      throw new GovernanceError(
        `Invalid EvaluateRequest: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_REQUEST',
        'config_error',
      );
    }

    const traceId = request.traceId ?? generateTraceId();

    // 1. Kill-Switch check
    if (this.killSwitch.isActive(this.tenantId)) {
      const timestamp = new Date().toISOString();
      const result: EvaluateResult = {
        allowed: false,
        traceId,
        reason: 'Kill-Switch is active — all tool calls denied',
        appliedRules: [],
      };

      this.eventEmitter.emitEvent({
        type: 'tool_call.denied',
        timestamp,
        traceId,
        agentId: request.agentId,
        tenantId: this.tenantId,
        data: {
          tool: request.tool,
          params: request.params,
          reason: result.reason,
          killSwitch: true,
        },
      });

      // Persist kill-switch denial to audit trail
      if (this.db?.writeAuditEvent) {
        try {
          await this.db.writeAuditEvent({
            traceId,
            timestamp,
            agentId: request.agentId,
            tool: request.tool,
            params: request.params,
            result: 'denied',
            reason: result.reason,
            durationMs: 0,
          });
        } catch (err) {
          this.logger.error({ err, traceId }, 'Failed to write audit event for kill-switch denial');
          this.eventEmitter.emitEvent({
            type: 'audit.write_failure',
            timestamp: new Date().toISOString(),
            traceId,
            agentId: request.agentId,
            tenantId: this.tenantId,
            data: { error: 'Database write failed', context: 'killswitch_denial' },
          });
        }
      }

      return result;
    }

    // 2. Policy resolution
    let policy = this.policy;
    if (!policy && this.db) {
      try {
        policy = await this.db.getActivePolicy(request.agentId);
      } catch (err) {
        this.logger.error({ err, agentId: request.agentId }, 'DB error during policy resolution — denying (fail-secure)');

        const result: EvaluateResult = {
          allowed: false,
          traceId,
          reason: 'Policy resolution failed — database error (fail-secure)',
          appliedRules: [],
        };

        this.eventEmitter.emitEvent({
          type: 'tool_call.denied',
          timestamp: new Date().toISOString(),
          traceId,
          agentId: request.agentId,
          tenantId: this.tenantId,
          data: {
            tool: request.tool,
            params: request.params,
            reason: result.reason,
          },
        });

        return result;
      }
    }
    if (!policy) {
      policy = defaultAllowAllPolicy();
    }

    // 3. PolicyEngine evaluate
    const result = this.policyEngine.evaluate(
      { ...request, traceId },
      policy,
    );

    // 3.5 Approval interception — allowed + requireApproval = pause
    if (result.allowed && result.appliedRules[0]?.requireApproval === true) {
      return this.handleApprovalRequired(request, result, policy);
    }

    // 4. Event emission
    const timestamp = new Date().toISOString();
    if (result.allowed) {
      this.eventEmitter.emitEvent({
        type: 'tool_call.allowed',
        timestamp,
        traceId: result.traceId,
        agentId: request.agentId,
        tenantId: this.tenantId,
        data: {
          tool: request.tool,
          params: request.params,
          appliedRules: result.appliedRules,
        },
      });
    } else {
      this.eventEmitter.emitEvent({
        type: 'tool_call.denied',
        timestamp,
        traceId: result.traceId,
        agentId: request.agentId,
        tenantId: this.tenantId,
        data: {
          tool: request.tool,
          params: request.params,
          reason: result.reason,
          appliedRules: result.appliedRules,
        },
      });
    }

    // 5. Audit trail persistence (if DB available)
    if (this.db?.writeAuditEvent) {
      try {
        await this.db.writeAuditEvent({
          traceId: result.traceId,
          timestamp,
          agentId: request.agentId,
          tool: request.tool,
          params: request.params,
          result: result.allowed ? 'allowed' : 'denied',
          reason: result.reason,
          durationMs: 0,
          failureCategory: result.allowed ? undefined : 'policy_denial',
        });
      } catch (err) {
        this.logger.error({ err, traceId: result.traceId }, 'Failed to write audit event — evaluate result unaffected');
        this.eventEmitter.emitEvent({
          type: 'audit.write_failure',
          timestamp: new Date().toISOString(),
          traceId: result.traceId,
          agentId: request.agentId,
          tenantId: this.tenantId,
          data: { error: 'Database write failed', context: 'policy_evaluation' },
        });
      }
    }

    return result;
  }

  // --- Agent CRUD (requires DB) ---

  async registerAgent(config: AgentConfig): Promise<string> {
    let parsed: AgentConfig;
    try {
      parsed = agentConfigSchema.parse(config) as AgentConfig;
    } catch (err) {
      throw new GovernanceError(
        `Invalid AgentConfig: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_CONFIG',
        'config_error',
      );
    }

    const db = this.requireDb('registerAgent');
    const id = await db.registerAgent(parsed);

    this.eventEmitter.emitEvent({
      type: 'agent.config_changed',
      timestamp: new Date().toISOString(),
      agentId: parsed.agentId,
      tenantId: this.tenantId,
      data: { action: 'registered', config: parsed },
    });

    return id;
  }

  async startAgent(agentId: string): Promise<void> {
    const db = this.requireDb('startAgent');
    await db.updateAgentStatus(agentId, 'running');

    this.eventEmitter.emitEvent({
      type: 'agent.started',
      timestamp: new Date().toISOString(),
      agentId,
      tenantId: this.tenantId,
      data: { agentId },
    });
  }

  async stopAgent(agentId: string, reason?: string): Promise<void> {
    const db = this.requireDb('stopAgent');
    await db.updateAgentStatus(agentId, 'stopped');

    this.eventEmitter.emitEvent({
      type: 'agent.stopped',
      timestamp: new Date().toISOString(),
      agentId,
      tenantId: this.tenantId,
      data: { agentId, reason },
    });
  }

  async getAgentStatus(agentId: string): Promise<AgentStatus | null> {
    const db = this.requireDb('getAgentStatus');
    return db.getAgentStatus(agentId);
  }

  async listAgents(): Promise<AgentStatus[]> {
    const db = this.requireDb('listAgents');
    return db.listAgents();
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const db = this.requireDb('deleteAgent');
    const deleted = await db.deleteAgent(agentId);

    if (deleted) {
      this.eventEmitter.emitEvent({
        type: 'agent.config_changed',
        timestamp: new Date().toISOString(),
        agentId,
        tenantId: this.tenantId,
        data: { action: 'deleted', agentId },
      });
    }

    return deleted;
  }

  // --- Kill-Switch ---

  emergencyStop(reason?: string): void {
    this.killSwitch.activate(reason ?? 'Manual emergency stop', this.tenantId);
  }

  resetKillSwitch(reason?: string): void {
    this.killSwitch.reset(this.tenantId, reason);
  }

  isKillSwitchActive(): boolean {
    return this.killSwitch.isActive(this.tenantId);
  }

  // --- Events ---

  on(type: GovernanceEventType, listener: GovernanceEventListener): void {
    this.eventEmitter.on(type, listener);
  }

  off(type: GovernanceEventType, listener: GovernanceEventListener): void {
    this.eventEmitter.off(type, listener);
  }

  // --- Kill-Switch Status ---

  getKillSwitchStatus(): KillSwitchStatus {
    return this.killSwitch.getStatus(this.tenantId);
  }

  // --- Policy ---

  setPolicy(policy: Policy): void {
    try {
      policySchema.parse(policy);
    } catch (err) {
      throw new GovernanceError(
        `Invalid Policy: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_POLICY',
        'config_error',
      );
    }
    this.policy = policy;
  }

  /**
   * Clear the inline policy. Subsequent evaluate() calls will
   * fall back to DB-based policy or default allow-all.
   */
  clearPolicy(): void {
    this.policy = null;
  }

  async writePolicy(policy: Policy): Promise<void> {
    try {
      policySchema.parse(policy);
    } catch (err) {
      throw new GovernanceError(
        `Invalid Policy: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_POLICY',
        'config_error',
      );
    }

    const db = this.requireDb('writePolicy');
    await db.writePolicy(policy);

    this.eventEmitter.emitEvent({
      type: 'policy.updated',
      timestamp: new Date().toISOString(),
      tenantId: this.tenantId,
      data: { policyName: policy.name, version: policy.version },
    });
  }

  async listPolicies(): Promise<Policy[]> {
    const db = this.requireDb('listPolicies');
    return db.listPolicies();
  }

  async getPolicyByName(name: string): Promise<Policy | null> {
    const db = this.requireDb('getPolicyByName');
    return db.getPolicyByName(name);
  }

  async deletePolicy(name: string): Promise<boolean> {
    const db = this.requireDb('deletePolicy');
    const deleted = await db.deletePolicy(name);

    if (deleted) {
      this.eventEmitter.emitEvent({
        type: 'policy.deleted',
        timestamp: new Date().toISOString(),
        tenantId: this.tenantId,
        data: { policyName: name },
      });
    }

    return deleted;
  }

  // --- Dry-Run ---

  /**
   * Evaluate a request against an inline policy without side effects.
   * NO kill-switch check, NO events, NO DB interaction.
   */
  evaluateDryRun(request: EvaluateRequest, policy: Policy): EvaluateResult {
    // Validate request
    try {
      evaluateRequestSchema.parse(request);
    } catch (err) {
      throw new GovernanceError(
        `Invalid EvaluateRequest: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_REQUEST',
        'config_error',
      );
    }

    // Validate policy
    try {
      policySchema.parse(policy);
    } catch (err) {
      throw new GovernanceError(
        `Invalid Policy: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_POLICY',
        'config_error',
      );
    }

    const traceId = request.traceId ?? generateTraceId();

    return this.policyEngine.evaluate(
      { ...request, traceId },
      policy,
    );
  }

  // --- Policy Versioning ---

  async getPolicyHistory(policyName: string): Promise<PolicyVersion[]> {
    const db = this.requireDb('getPolicyHistory');
    return db.getPolicyHistory(policyName);
  }

  async getPolicyVersion(policyName: string, versionId: number): Promise<PolicyVersion | null> {
    const db = this.requireDb('getPolicyVersion');
    return db.getPolicyVersion(policyName, versionId);
  }

  async rollbackPolicy(policyName: string, versionId: number): Promise<Policy> {
    const db = this.requireDb('rollbackPolicy');

    const version = await db.getPolicyVersion(policyName, versionId);
    if (!version) {
      throw new GovernanceError(
        `Policy version ${versionId} not found for policy '${policyName}'`,
        'VERSION_NOT_FOUND',
        'config_error',
      );
    }

    const policy: Policy = {
      name: version.policyName,
      version: version.version,
      agentId: version.agentId,
      rules: version.rules,
      createdAt: version.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // writePolicy auto-snapshots the current version before overwriting
    await db.writePolicy(policy);

    this.eventEmitter.emitEvent({
      type: 'policy.updated',
      timestamp: new Date().toISOString(),
      tenantId: this.tenantId,
      data: {
        policyName,
        version: version.version,
        action: 'rollback',
        fromVersionId: versionId,
      },
    });

    return policy;
  }

  // --- Approval Workflows ---

  /**
   * Get a single approval request by ID.
   * Implements lazy timeout: if pending and past deadline, auto-resolves to 'timeout'.
   */
  async getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
    const db = this.requireDb('getApprovalRequest');
    if (!db.getApprovalRequest) {
      throw new GovernanceError(
        'Approval methods not available on this DatabaseAdapter',
        'APPROVAL_NOT_SUPPORTED',
        'config_error',
      );
    }

    const approval = await db.getApprovalRequest(id);
    if (!approval) return null;

    // Lazy timeout: pending + past deadline → auto-resolve
    if (approval.status === 'pending' && new Date(approval.deadline) < new Date()) {
      await this.resolveApproval(id, { status: 'timeout' });
      return db.getApprovalRequest(id);
    }

    return approval;
  }

  /**
   * List approval requests with optional filtering.
   * Applies lazy timeout to all overdue pending items.
   */
  async listApprovalRequests(filter?: ApprovalFilter): Promise<ApprovalRequest[]> {
    const db = this.requireDb('listApprovalRequests');
    if (!db.listApprovalRequests) {
      throw new GovernanceError(
        'Approval methods not available on this DatabaseAdapter',
        'APPROVAL_NOT_SUPPORTED',
        'config_error',
      );
    }

    const results = await db.listApprovalRequests(filter);

    // Lazy timeout for overdue pending items
    const now = new Date();
    for (const approval of results) {
      if (approval.status === 'pending' && new Date(approval.deadline) < now) {
        await this.resolveApproval(approval.id, { status: 'timeout' });
      }
    }

    // Re-fetch to get updated statuses if any were timed out
    return db.listApprovalRequests(filter);
  }

  /**
   * Resolve an approval request (approve, reject, or timeout).
   * Uses optimistic locking — returns { resolved, approval }.
   */
  async resolveApproval(
    id: string,
    resolution: ApprovalResolution,
  ): Promise<{ resolved: boolean; approval?: ApprovalRequest }> {
    const db = this.requireDb('resolveApproval');
    if (!db.resolveApprovalRequest || !db.getApprovalRequest) {
      throw new GovernanceError(
        'Approval methods not available on this DatabaseAdapter',
        'APPROVAL_NOT_SUPPORTED',
        'config_error',
      );
    }

    const resolved = await db.resolveApprovalRequest(id, resolution);
    if (!resolved) {
      return { resolved: false };
    }

    const approval = await db.getApprovalRequest(id);
    if (!approval) {
      return { resolved: false };
    }

    // Emit appropriate event
    const eventTypeMap: Record<string, string> = {
      approved: 'approval.granted',
      rejected: 'approval.rejected',
      timeout: 'approval.timeout',
    };
    const eventType = eventTypeMap[approval.status];
    if (eventType) {
      this.eventEmitter.emitEvent({
        type: eventType as 'approval.granted' | 'approval.rejected' | 'approval.timeout',
        timestamp: new Date().toISOString(),
        traceId: approval.traceId,
        agentId: approval.agentId,
        tenantId: this.tenantId,
        data: {
          approvalId: approval.id,
          tool: approval.tool,
          policyName: approval.policyName,
          ruleName: approval.ruleName,
          approver: approval.approver,
          comment: approval.comment,
        },
      });
    }

    // Write audit event
    if (db.writeAuditEvent) {
      const auditResult = approval.status === 'approved' ? 'allowed' : 'denied';
      await db.writeAuditEvent({
        traceId: approval.traceId,
        timestamp: new Date().toISOString(),
        agentId: approval.agentId,
        tool: approval.tool,
        params: approval.params,
        result: auditResult,
        reason: approval.status === 'timeout'
          ? 'Approval request timed out'
          : `Approval ${approval.status} by ${approval.approver ?? 'unknown'}`,
        durationMs: 0,
        failureCategory: approval.status === 'timeout' ? 'approval_timeout' : undefined,
      });
    }

    return { resolved: true, approval };
  }

  // --- Internal ---

  /**
   * Handle a tool call that requires approval.
   * Creates an approval request, emits event, returns requiresApproval result.
   */
  private async handleApprovalRequired(
    request: EvaluateRequest,
    result: EvaluateResult,
    _policy: Policy,
  ): Promise<EvaluateResult> {
    const db = this.db;
    if (!db?.createApprovalRequest) {
      // Fail-secure: no DB or no approval support → deny
      this.logger.warn(
        { agentId: request.agentId, tool: request.tool },
        'requireApproval set but no approval DB available — denied (fail-secure)',
      );

      this.eventEmitter.emitEvent({
        type: 'tool_call.denied',
        timestamp: new Date().toISOString(),
        traceId: result.traceId,
        agentId: request.agentId,
        tenantId: this.tenantId,
        data: {
          tool: request.tool,
          params: request.params,
          reason: 'Approval required but approval infrastructure not available',
        },
      });

      return {
        allowed: false,
        traceId: result.traceId,
        reason: 'Approval required but approval infrastructure not available',
        appliedRules: result.appliedRules,
        requiresApproval: true,
      };
    }

    const winningRule = result.appliedRules[0];
    const deadline = new Date(
      Date.now() + this.approvalTimeoutSeconds * 1000,
    ).toISOString();

    const approval = await db.createApprovalRequest({
      agentId: request.agentId,
      tool: request.tool,
      params: request.params,
      traceId: result.traceId,
      policyName: winningRule.policyName,
      ruleName: winningRule.ruleName,
      deadline,
    });

    this.eventEmitter.emitEvent({
      type: 'approval.requested',
      timestamp: new Date().toISOString(),
      traceId: result.traceId,
      agentId: request.agentId,
      tenantId: this.tenantId,
      data: {
        approvalId: approval.id,
        tool: request.tool,
        params: request.params,
        policyName: winningRule.policyName,
        ruleName: winningRule.ruleName,
        deadline,
      },
    });

    return {
      allowed: false,
      traceId: result.traceId,
      reason: `Approval required — request ${approval.id} pending`,
      appliedRules: result.appliedRules,
      requiresApproval: true,
      approvalId: approval.id,
      deadline,
    };
  }

  private requireDb(method: string): DatabaseAdapter {
    if (!this.db) {
      throw new GovernanceError(
        `${method}() requires a DatabaseAdapter — pass { db } in constructor options`,
        'DATABASE_REQUIRED',
        'config_error',
      );
    }
    return this.db;
  }
}
