/**
 * @agentbouncr/core — Shared Types
 *
 * GovernanceError, Failure Categories, and shared interfaces
 * used across all governance modules.
 */

import type { GovernanceTool, RiskLevel } from '../schema/tool-schema.js';

// --- Failure Categories ---

export type FailureCategory =
  | 'tool_error'
  | 'policy_denial'
  | 'provider_timeout'
  | 'provider_error'
  | 'injection_alert'
  | 'config_error'
  | 'rate_limit'
  | 'approval_timeout';

// --- GovernanceError ---

export class GovernanceError extends Error {
  public override readonly name = 'GovernanceError';

  constructor(
    message: string,
    public readonly code: string,
    public readonly category: FailureCategory,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// --- Injection Detection ---

export interface InjectionDetectionResult {
  detected: boolean;
  patterns: string[];
  text: string;
}

// --- Kill Switch ---

export interface KillSwitchResult {
  triggered: boolean;
  command: string | null;
}

// --- Permission Check ---

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  toolName: string;
  agentId: string;
}

// --- Governance Evaluation (Main API) ---

export interface EvaluateRequest {
  agentId: string;
  tool: string;
  params?: Record<string, unknown>;
  traceId?: string;
}

export interface EvaluateResult {
  allowed: boolean;
  traceId: string;
  reason?: string;
  appliedRules: AppliedRule[];
  requiresApproval?: boolean;
  approvalId?: string;
  deadline?: string;
}

export interface AppliedRule {
  policyName: string;
  ruleName?: string;
  effect: 'allow' | 'deny';
  requireApproval?: boolean;
}

// --- Tool Execution (for SDK/Middleware mode) ---

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolExecutionContext {
  agentId: string;
  traceId: string;
  [key: string]: unknown;
}

// --- Audit Trail ---

export interface AuditEvent {
  id?: number;
  traceId: string;
  timestamp: string;
  agentId: string;
  tool: string;
  params?: Record<string, unknown>;
  result: 'allowed' | 'denied' | 'error' | 'retention_boundary';
  reason?: string;
  durationMs: number;
  failureCategory?: FailureCategory;
  previousHash: string | null;
  hash: string;
}

export type AuditEventInput = Omit<AuditEvent, 'id' | 'previousHash' | 'hash'>;

export interface AuditFilter {
  agentId?: string;
  tool?: string;
  result?: 'allowed' | 'denied' | 'error' | 'retention_boundary';
  traceId?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  failureCategory?: FailureCategory;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditChainVerificationResult {
  valid: boolean;
  brokenAt?: number;
  totalEvents: number;
  verifiedEvents: number;
}

// --- Policy ---

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'matches';

/**
 * Policy condition: maps parameter names to operator-value pairs.
 * Example: { "path": { "startsWith": "/etc/" }, "amount": { "gt": 1000 } }
 * All conditions are AND-combined (conjunctive).
 */
export type PolicyCondition = Record<string, Partial<Record<ConditionOperator, unknown>>>;

export interface Policy {
  name: string;
  version: string;
  agentId?: string;
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRule {
  name?: string;
  tool: string;
  effect: 'allow' | 'deny';
  condition?: PolicyCondition;
  reason?: string;
  rateLimit?: { maxPerMinute: number };
  requireApproval?: boolean;
}

// --- Agent Lifecycle ---

export type AgentRunStatus = 'registered' | 'running' | 'stopped' | 'error';

export interface AgentConfig {
  agentId: string;
  name: string;
  description?: string;
  allowedTools: string[];
  policyName?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentStatus {
  agentId: string;
  name: string;
  status: AgentRunStatus;
  registeredAt: string;
  lastActiveAt?: string;
}

// --- Policy Versioning ---

export interface PolicyVersion {
  id: number;
  policyName: string;
  version: string;
  agentId?: string;
  rules: PolicyRule[];
  author: string;
  createdAt: string;
}

// --- Governance Events ---

export interface GovernanceEventRecord {
  id?: number;
  agentId: string;
  eventType: string;
  timestamp: string;
  traceId?: string;
  data?: Record<string, unknown>;
  receivedAt?: string;
}

export interface GovernanceEventFilter {
  agentId?: string;
  eventType?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
  offset?: number;
}

// --- Approval Requests ---

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface ApprovalRequest {
  id: string;
  agentId: string;
  tool: string;
  params?: Record<string, unknown>;
  traceId: string;
  policyName: string;
  ruleName?: string;
  status: ApprovalStatus;
  deadline: string;
  approver?: string;
  comment?: string;
  createdAt: string;
  resolvedAt?: string;
  tenantId: string;
}

export interface ApprovalRequestInput {
  agentId: string;
  tool: string;
  params?: Record<string, unknown>;
  traceId: string;
  policyName: string;
  ruleName?: string;
  deadline: string;
}

export interface ApprovalFilter {
  agentId?: string;
  status?: ApprovalStatus;
  tool?: string;
  limit?: number;
  offset?: number;
}

export interface ApprovalResolution {
  status: 'approved' | 'rejected' | 'timeout';
  approver?: string;
  comment?: string;
}

// --- Tool Filter ---

export interface ToolFilter {
  source?: 'manual' | 'import' | 'mcp';
  riskLevel?: RiskLevel;
  category?: string;
  /** Search in tool name and description */
  search?: string;
}

// --- DatabaseAdapter ---

export interface TransactionClient {
  run(sql: string, params?: unknown[]): void;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
}

export interface DatabaseAdapter {
  // Audit Trail (5)
  writeAuditEvent(event: AuditEventInput): Promise<void>;
  queryAuditEvents(filter: AuditFilter): Promise<AuditEvent[]>;
  getLatestAuditHash(): Promise<string | null>;
  verifyAuditChain(): Promise<AuditChainVerificationResult>;
  exportAuditEvents(filter: AuditFilter, stream: NodeJS.WritableStream): Promise<void>;

  // Policy (5)
  writePolicy(policy: Policy): Promise<void>;
  getActivePolicy(agentId: string): Promise<Policy | null>;
  listPolicies(): Promise<Policy[]>;
  getPolicyByName(name: string): Promise<Policy | null>;
  deletePolicy(name: string): Promise<boolean>;

  // Policy Versioning (3)
  writePolicyVersion(policyName: string, policy: Policy, author: string): Promise<void>;
  getPolicyHistory(policyName: string): Promise<PolicyVersion[]>;
  getPolicyVersion(policyName: string, versionId: number): Promise<PolicyVersion | null>;

  // Agent Lifecycle (5)
  registerAgent(config: AgentConfig): Promise<string>;
  getAgentStatus(agentId: string): Promise<AgentStatus | null>;
  updateAgentStatus(agentId: string, status: AgentRunStatus): Promise<void>;
  listAgents(): Promise<AgentStatus[]>;
  deleteAgent(agentId: string): Promise<boolean>;

  // Tool Registry (4)
  writeTool(tool: GovernanceTool): Promise<void>;
  getTool(name: string): Promise<GovernanceTool | null>;
  listTools(filter?: ToolFilter): Promise<GovernanceTool[]>;
  deleteTool(name: string): Promise<boolean>;

  // Governance Events (2)
  writeGovernanceEvent(event: GovernanceEventRecord): Promise<void>;
  queryGovernanceEvents(filter: GovernanceEventFilter): Promise<GovernanceEventRecord[]>;

  // Schema Management (2)
  runMigrations(): Promise<void>;
  getSchemaVersion(): Promise<number>;

  // Transaction (1)
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;

  // Approval Requests (4), optional
  createApprovalRequest?(request: ApprovalRequestInput): Promise<ApprovalRequest>;
  getApprovalRequest?(id: string): Promise<ApprovalRequest | null>;
  listApprovalRequests?(filter?: ApprovalFilter): Promise<ApprovalRequest[]>;
  resolveApprovalRequest?(id: string, resolution: ApprovalResolution): Promise<boolean>;

  // Multi-Tenant (1) — optional, implemented by PostgresAdapter
  forTenant?(tenantId: string): DatabaseAdapter;

  // Lifecycle (1)
  close(): Promise<void>;
}
