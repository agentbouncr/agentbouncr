/**
 * @agentbouncr/sqlite — SQLite DatabaseAdapter
 *
 * Implements the DatabaseAdapter interface using better-sqlite3.
 * better-sqlite3 is synchronous — async methods are thin wrappers
 * returning Promise.resolve() for interface conformity.
 *
 * Audit Trail: Append-only with SHA-256 hash-chain.
 * Schema: Auto-migrated on runMigrations().
 */

import Database from 'better-sqlite3';
import type pino from 'pino';
import { randomUUID } from 'node:crypto';
import { computeAuditHash, GovernanceError } from '@agentbouncr/core';
import type {
  DatabaseAdapter,
  AuditEvent,
  AuditEventInput,
  AuditFilter,
  AuditChainVerificationResult,
  Policy,
  PolicyVersion,
  AgentConfig,
  AgentStatus,
  AgentRunStatus,
  TransactionClient,
  ToolFilter,
  GovernanceEventRecord,
  GovernanceEventFilter,
  ApprovalRequest,
  ApprovalRequestInput,
  ApprovalFilter,
  ApprovalResolution,
} from '@agentbouncr/core';
import type { GovernanceTool } from '@agentbouncr/core';
import { runMigrations } from './migrations.js';

// --- Internal row types (snake_case from SQLite) ---

interface AuditRow {
  id: number;
  trace_id: string;
  timestamp: string;
  agent_id: string;
  tool: string;
  params: string | null;
  result: string;
  reason: string | null;
  duration_ms: number;
  failure_category: string | null;
  previous_hash: string | null;
  hash: string;
}

interface PolicyRow {
  name: string;
  version: string;
  agent_id: string | null;
  rules: string;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  agent_id: string;
  name: string;
  description: string | null;
  allowed_tools: string;
  policy_name: string | null;
  metadata: string | null;
  status: string;
  registered_at: string;
  last_active_at: string | null;
}

interface PolicyVersionRow {
  id: number;
  policy_name: string;
  version: string;
  agent_id: string | null;
  rules: string;
  author: string;
  created_at: string;
}

interface ToolRow {
  name: string;
  description: string | null;
  parameters: string;
  risk_level: string;
  category: string | null;
  source: string;
  version: string | null;
  tags: string | null;
  timeout: number | null;
  created_at: string;
  updated_at: string;
}

interface GovernanceEventRow {
  id: number;
  agent_id: string;
  event_type: string;
  timestamp: string;
  trace_id: string | null;
  data: string | null;
  received_at: string;
}

interface ApprovalRequestRow {
  id: string;
  agent_id: string;
  tool: string;
  params: string | null;
  trace_id: string;
  policy_name: string;
  rule_name: string | null;
  status: string;
  deadline: string;
  approver: string | null;
  comment: string | null;
  created_at: string;
  resolved_at: string | null;
  tenant_id: string;
}

// --- Adapter ---

export class SqliteDatabaseAdapter implements DatabaseAdapter {
  private readonly db: Database.Database;
  private migrationsDir: string;

  constructor(
    private readonly logger: pino.Logger,
    dbPath: string = './governance.db',
    migrationsDir?: string,
  ) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Default: migrations/ relative to project root
    this.migrationsDir = migrationsDir ?? './migrations';
  }

  // --- Multi-Tenant (no-op for SQLite — single-tenant only) ---

  forTenant(_tenantId: string): SqliteDatabaseAdapter {
    this.logger.warn(
      { tenantId: _tenantId },
      'SQLite has no tenant isolation — forTenant() returns unscoped adapter. Use PostgreSQL with RLS for multi-tenant.',
    );
    return this;
  }

  // --- Schema Management ---

  async runMigrations(): Promise<void> {
    runMigrations(this.db, this.logger, this.migrationsDir);
  }

  async getSchemaVersion(): Promise<number> {
    try {
      const row = this.db.prepare(
        'SELECT MAX(version) as version FROM schema_version',
      ).get() as { version: number | null } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  // --- Audit Trail ---

  async writeAuditEvent(event: AuditEventInput): Promise<void> {
    const previousHash = await this.getLatestAuditHash();

    const hash = computeAuditHash({
      traceId: event.traceId,
      timestamp: event.timestamp,
      agentId: event.agentId,
      tool: event.tool,
      params: event.params,
      result: event.result,
      reason: event.reason,
      durationMs: event.durationMs,
      failureCategory: event.failureCategory,
      previousHash,
    });

    this.db.prepare(`
      INSERT INTO audit_events (
        trace_id, timestamp, agent_id, tool, params, result,
        reason, duration_ms, failure_category, previous_hash, hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.traceId,
      event.timestamp,
      event.agentId,
      event.tool,
      event.params ? JSON.stringify(event.params) : null,
      event.result,
      event.reason ?? null,
      event.durationMs,
      event.failureCategory ?? null,
      previousHash,
      hash,
    );
  }

  async queryAuditEvents(filter: AuditFilter): Promise<AuditEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.agentId) {
      conditions.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter.tool) {
      conditions.push('tool = ?');
      params.push(filter.tool);
    }
    if (filter.result) {
      conditions.push('result = ?');
      params.push(filter.result);
    }
    if (filter.traceId) {
      conditions.push('trace_id = ?');
      params.push(filter.traceId);
    }
    if (filter.fromTimestamp) {
      conditions.push('timestamp >= ?');
      params.push(filter.fromTimestamp);
    }
    if (filter.toTimestamp) {
      conditions.push('timestamp <= ?');
      params.push(filter.toTimestamp);
    }
    if (filter.failureCategory) {
      conditions.push('failure_category = ?');
      params.push(filter.failureCategory);
    }
    if (filter.search) {
      conditions.push('(reason LIKE ? ESCAPE \'!\' OR params LIKE ? ESCAPE \'!\')');
      const term = `%${filter.search.replace(/[!%_]/g, '!$&')}%`;
      params.push(term, term);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    let sql = `SELECT * FROM audit_events ${where} ORDER BY id ASC`;

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    if (filter.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as AuditRow[];
    return rows.map(rowToAuditEvent);
  }

  async getLatestAuditHash(): Promise<string | null> {
    const row = this.db.prepare(
      'SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1',
    ).get() as { hash: string } | undefined;
    return row?.hash ?? null;
  }

  async verifyAuditChain(): Promise<AuditChainVerificationResult> {
    const rows = this.db.prepare(
      'SELECT * FROM audit_events ORDER BY id ASC',
    ).all() as AuditRow[];

    if (rows.length === 0) {
      return { valid: true, totalEvents: 0, verifiedEvents: 0 };
    }

    let previousHash: string | null = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Check chain link: previousHash must match the previous event's hash
      if (row.previous_hash !== previousHash) {
        return {
          valid: false,
          brokenAt: row.id,
          totalEvents: rows.length,
          verifiedEvents: i,
        };
      }

      // Recompute hash and compare
      const expectedHash = computeAuditHash({
        traceId: row.trace_id,
        timestamp: row.timestamp,
        agentId: row.agent_id,
        tool: row.tool,
        params: row.params ? (JSON.parse(row.params) as Record<string, unknown>) : undefined,
        result: row.result,
        reason: row.reason ?? undefined,
        durationMs: row.duration_ms,
        failureCategory: row.failure_category ?? undefined,
        previousHash: row.previous_hash,
      });

      if (row.hash !== expectedHash) {
        return {
          valid: false,
          brokenAt: row.id,
          totalEvents: rows.length,
          verifiedEvents: i,
        };
      }

      previousHash = row.hash;
    }

    return {
      valid: true,
      totalEvents: rows.length,
      verifiedEvents: rows.length,
    };
  }

  async exportAuditEvents(
    filter: AuditFilter,
    stream: NodeJS.WritableStream,
  ): Promise<void> {
    const events = await this.queryAuditEvents(filter);
    for (const event of events) {
      stream.write(JSON.stringify(event) + '\n');
    }
    stream.end();
  }

  // --- Policy ---

  async writePolicy(policy: Policy): Promise<void> {
    // Snapshot current version before overwriting
    const existing = this.db.prepare(
      'SELECT * FROM policies WHERE name = ?',
    ).get(policy.name) as PolicyRow | undefined;

    if (existing) {
      this.db.prepare(`
        INSERT INTO policy_versions (policy_name, version, agent_id, rules, author, created_at)
        VALUES (?, ?, ?, ?, 'api', ?)
      `).run(
        existing.name,
        existing.version,
        existing.agent_id,
        existing.rules,
        existing.updated_at,
      );
    }

    this.db.prepare(`
      INSERT INTO policies (name, version, agent_id, rules, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        version = excluded.version,
        agent_id = excluded.agent_id,
        rules = excluded.rules,
        updated_at = excluded.updated_at
    `).run(
      policy.name,
      policy.version,
      policy.agentId ?? null,
      JSON.stringify(policy.rules),
      policy.createdAt,
      policy.updatedAt,
    );
  }

  async listPolicies(): Promise<Policy[]> {
    const rows = this.db.prepare(
      'SELECT * FROM policies ORDER BY updated_at DESC',
    ).all() as PolicyRow[];

    return rows.map(rowToPolicy);
  }

  async getPolicyByName(name: string): Promise<Policy | null> {
    const row = this.db.prepare(
      'SELECT * FROM policies WHERE name = ?',
    ).get(name) as PolicyRow | undefined;

    if (!row) return null;
    return rowToPolicy(row);
  }

  async deletePolicy(name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM policies WHERE name = ?').run(name);
    return result.changes > 0;
  }

  async getActivePolicy(agentId: string): Promise<Policy | null> {
    // First check for agent-specific policy, then global
    const row = this.db.prepare(`
      SELECT * FROM policies
      WHERE agent_id = ? OR agent_id IS NULL
      ORDER BY
        CASE WHEN agent_id IS NOT NULL THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
    `).get(agentId) as PolicyRow | undefined;

    if (!row) return null;
    return rowToPolicy(row);
  }

  // --- Policy Versioning ---

  async writePolicyVersion(policyName: string, policy: Policy, author: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO policy_versions (policy_name, version, agent_id, rules, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      policyName,
      policy.version,
      policy.agentId ?? null,
      JSON.stringify(policy.rules),
      author,
      policy.updatedAt,
    );
  }

  async getPolicyHistory(policyName: string): Promise<PolicyVersion[]> {
    const rows = this.db.prepare(
      'SELECT * FROM policy_versions WHERE policy_name = ? ORDER BY created_at DESC',
    ).all(policyName) as PolicyVersionRow[];
    return rows.map(rowToPolicyVersion);
  }

  async getPolicyVersion(policyName: string, versionId: number): Promise<PolicyVersion | null> {
    const row = this.db.prepare(
      'SELECT * FROM policy_versions WHERE policy_name = ? AND id = ?',
    ).get(policyName, versionId) as PolicyVersionRow | undefined;
    if (!row) return null;
    return rowToPolicyVersion(row);
  }

  // --- Agent Lifecycle ---

  async registerAgent(config: AgentConfig): Promise<string> {
    this.db.prepare(`
      INSERT OR REPLACE INTO agents (
        agent_id, name, description, allowed_tools, policy_name, metadata, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'registered')
    `).run(
      config.agentId,
      config.name,
      config.description ?? null,
      JSON.stringify(config.allowedTools),
      config.policyName ?? null,
      config.metadata ? JSON.stringify(config.metadata) : null,
    );

    return config.agentId;
  }

  async getAgentStatus(agentId: string): Promise<AgentStatus | null> {
    const row = this.db.prepare(
      'SELECT * FROM agents WHERE agent_id = ?',
    ).get(agentId) as AgentRow | undefined;

    if (!row) return null;

    return rowToAgentStatus(row);
  }

  async updateAgentStatus(agentId: string, status: AgentRunStatus): Promise<void> {
    const result = this.db.prepare(
      "UPDATE agents SET status = ?, last_active_at = datetime('now') WHERE agent_id = ?",
    ).run(status, agentId);

    if (result.changes === 0) {
      throw new GovernanceError(
        `Agent '${agentId}' not found`,
        'AGENT_NOT_FOUND',
        'config_error',
        { agentId },
      );
    }
  }

  async listAgents(): Promise<AgentStatus[]> {
    const rows = this.db.prepare(
      'SELECT * FROM agents ORDER BY registered_at ASC',
    ).all() as AgentRow[];

    return rows.map(rowToAgentStatus);
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM agents WHERE agent_id = ?').run(agentId);
    return result.changes > 0;
  }

  // --- Tool Registry ---

  async writeTool(tool: GovernanceTool): Promise<void> {
    this.db.prepare(`
      INSERT INTO tools (
        name, description, parameters, risk_level, category,
        source, version, tags, timeout
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        parameters = excluded.parameters,
        risk_level = excluded.risk_level,
        category = excluded.category,
        source = excluded.source,
        version = excluded.version,
        tags = excluded.tags,
        timeout = excluded.timeout,
        updated_at = datetime('now')
    `).run(
      tool.name,
      tool.description ?? null,
      JSON.stringify(tool.parameters),
      tool.riskLevel,
      tool.category ?? null,
      tool.source,
      tool.version ?? null,
      tool.tags ? JSON.stringify(tool.tags) : null,
      tool.timeout ?? null,
    );
  }

  async getTool(name: string): Promise<GovernanceTool | null> {
    const row = this.db.prepare(
      'SELECT * FROM tools WHERE name = ?',
    ).get(name) as ToolRow | undefined;

    if (!row) return null;
    return rowToGovernanceTool(row);
  }

  async listTools(filter?: ToolFilter): Promise<GovernanceTool[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.source) {
      conditions.push('source = ?');
      params.push(filter.source);
    }
    if (filter?.riskLevel) {
      conditions.push('risk_level = ?');
      params.push(filter.riskLevel);
    }
    if (filter?.category) {
      conditions.push('category = ?');
      params.push(filter.category);
    }
    if (filter?.search) {
      // Escape LIKE metacharacters so user input is treated as literal
      const escaped = filter.search.replace(/[!%_]/g, '!$&');
      conditions.push("(name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')");
      const searchPattern = `%${escaped}%`;
      params.push(searchPattern, searchPattern);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const rows = this.db.prepare(
      `SELECT * FROM tools ${where} ORDER BY name ASC`,
    ).all(...params) as ToolRow[];

    return rows.map(rowToGovernanceTool);
  }

  async deleteTool(name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM tools WHERE name = ?').run(name);
    return result.changes > 0;
  }

  // --- Governance Events ---

  async writeGovernanceEvent(event: GovernanceEventRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO governance_events (agent_id, event_type, timestamp, trace_id, data, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      event.agentId,
      event.eventType,
      event.timestamp,
      event.traceId ?? null,
      event.data ? JSON.stringify(event.data) : null,
      event.receivedAt ?? new Date().toISOString(),
    );
  }

  async queryGovernanceEvents(filter: GovernanceEventFilter): Promise<GovernanceEventRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.agentId) {
      conditions.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter.eventType) {
      conditions.push('event_type = ?');
      params.push(filter.eventType);
    }
    if (filter.fromTimestamp) {
      conditions.push('timestamp >= ?');
      params.push(filter.fromTimestamp);
    }
    if (filter.toTimestamp) {
      conditions.push('timestamp <= ?');
      params.push(filter.toTimestamp);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const rows = this.db.prepare(
      `SELECT * FROM governance_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as GovernanceEventRow[];

    return rows.map(rowToGovernanceEvent);
  }

  // --- Approval Requests ---

  async createApprovalRequest(request: ApprovalRequestInput): Promise<ApprovalRequest> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO approval_requests (id, agent_id, tool, params, trace_id, policy_name, rule_name, status, deadline, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      id,
      request.agentId,
      request.tool,
      request.params ? JSON.stringify(request.params) : null,
      request.traceId,
      request.policyName,
      request.ruleName ?? null,
      request.deadline,
      createdAt,
    );

    return {
      id,
      agentId: request.agentId,
      tool: request.tool,
      params: request.params,
      traceId: request.traceId,
      policyName: request.policyName,
      ruleName: request.ruleName,
      status: 'pending',
      deadline: request.deadline,
      createdAt,
      tenantId: 'default',
    };
  }

  async getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
    const row = this.db.prepare(
      'SELECT * FROM approval_requests WHERE id = ?',
    ).get(id) as ApprovalRequestRow | undefined;

    if (!row) return null;
    return rowToApprovalRequest(row);
  }

  async listApprovalRequests(filter?: ApprovalFilter): Promise<ApprovalRequest[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.agentId) {
      conditions.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.tool) {
      conditions.push('tool = ?');
      params.push(filter.tool);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;

    const rows = this.db.prepare(
      `SELECT * FROM approval_requests ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as ApprovalRequestRow[];

    return rows.map(rowToApprovalRequest);
  }

  async resolveApprovalRequest(id: string, resolution: ApprovalResolution): Promise<boolean> {
    const result = this.db.prepare(
      `UPDATE approval_requests
       SET status = ?, approver = ?, comment = ?, resolved_at = datetime('now')
       WHERE id = ? AND status = 'pending'
         AND (? = 'timeout' OR datetime(deadline) > datetime('now'))`,
    ).run(
      resolution.status,
      resolution.approver ?? null,
      resolution.comment ?? null,
      id,
      resolution.status,
    );
    return result.changes > 0;
  }

  // --- Transaction ---

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    const client: TransactionClient = {
      run: (sql: string, params?: unknown[]) => {
        this.db.prepare(sql).run(...(params ?? []));
      },
      get: <R>(sql: string, params?: unknown[]) => {
        return this.db.prepare(sql).get(...(params ?? [])) as R | undefined;
      },
      all: <R>(sql: string, params?: unknown[]) => {
        return this.db.prepare(sql).all(...(params ?? [])) as R[];
      },
    };

    // Manual BEGIN/COMMIT/ROLLBACK — better-sqlite3's .transaction()
    // does not support async callbacks (throws on Promise return).
    this.db.exec('BEGIN');
    try {
      const result = await fn(client);
      this.db.exec('COMMIT');
      return result;
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // --- Lifecycle ---

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch {
      // Ignore double-close errors
    }
  }
}

// --- Helpers ---

function rowToAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    traceId: row.trace_id,
    timestamp: row.timestamp,
    agentId: row.agent_id,
    tool: row.tool,
    params: row.params ? (JSON.parse(row.params) as Record<string, unknown>) : undefined,
    result: row.result as AuditEvent['result'],
    reason: row.reason ?? undefined,
    durationMs: row.duration_ms,
    failureCategory: row.failure_category as AuditEvent['failureCategory'],
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}

function rowToPolicy(row: PolicyRow): Policy {
  return {
    name: row.name,
    version: row.version,
    agentId: row.agent_id ?? undefined,
    rules: JSON.parse(row.rules) as Policy['rules'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAgentStatus(row: AgentRow): AgentStatus {
  return {
    agentId: row.agent_id,
    name: row.name,
    status: row.status as AgentStatus['status'],
    registeredAt: row.registered_at,
    lastActiveAt: row.last_active_at ?? undefined,
  };
}

function rowToPolicyVersion(row: PolicyVersionRow): PolicyVersion {
  return {
    id: row.id,
    policyName: row.policy_name,
    version: row.version,
    agentId: row.agent_id ?? undefined,
    rules: JSON.parse(row.rules) as PolicyVersion['rules'],
    author: row.author,
    createdAt: row.created_at,
  };
}

function rowToGovernanceTool(row: ToolRow): GovernanceTool {
  return {
    name: row.name,
    description: row.description ?? undefined,
    parameters: JSON.parse(row.parameters) as GovernanceTool['parameters'],
    riskLevel: row.risk_level as GovernanceTool['riskLevel'],
    category: row.category ?? undefined,
    source: row.source as GovernanceTool['source'],
    version: row.version ?? undefined,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined,
    timeout: row.timeout ?? undefined,
  };
}

function rowToGovernanceEvent(row: GovernanceEventRow): GovernanceEventRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    eventType: row.event_type,
    timestamp: row.timestamp,
    traceId: row.trace_id ?? undefined,
    data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : undefined,
    receivedAt: row.received_at,
  };
}

function rowToApprovalRequest(row: ApprovalRequestRow): ApprovalRequest {
  return {
    id: row.id,
    agentId: row.agent_id,
    tool: row.tool,
    params: row.params ? (JSON.parse(row.params) as Record<string, unknown>) : undefined,
    traceId: row.trace_id,
    policyName: row.policy_name,
    ruleName: row.rule_name ?? undefined,
    status: row.status as ApprovalRequest['status'],
    deadline: row.deadline,
    approver: row.approver ?? undefined,
    comment: row.comment ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    tenantId: row.tenant_id,
  };
}

