import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import {
  GovernanceMiddleware,
  GovernanceError,
  type Policy,
  type DatabaseAdapter,
  type PolicyVersion,
} from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    name: 'test-policy',
    version: '1.0',
    rules: [{ tool: '*', effect: 'allow' }],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDenyPolicy(): Policy {
  return makePolicy({
    rules: [
      { tool: 'file_write', effect: 'deny', condition: { path: { startsWith: '/etc/' } }, reason: 'Forbidden path' },
      { tool: '*', effect: 'allow' },
    ],
  });
}

function makeVersion(overrides?: Partial<PolicyVersion>): PolicyVersion {
  return {
    id: 1,
    policyName: 'test-policy',
    version: '1.0',
    rules: [{ tool: '*', effect: 'allow' }],
    author: 'api',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function mockDb(overrides?: Partial<DatabaseAdapter>): DatabaseAdapter {
  return {
    writeAuditEvent: vi.fn(),
    queryAuditEvents: vi.fn(),
    getLatestAuditHash: vi.fn(),
    verifyAuditChain: vi.fn(),
    exportAuditEvents: vi.fn(),
    writePolicy: vi.fn(),
    getActivePolicy: vi.fn(),
    listPolicies: vi.fn(),
    getPolicyByName: vi.fn(),
    deletePolicy: vi.fn(),
    writePolicyVersion: vi.fn(),
    getPolicyHistory: vi.fn().mockResolvedValue([]),
    getPolicyVersion: vi.fn().mockResolvedValue(null),
    registerAgent: vi.fn(),
    getAgentStatus: vi.fn(),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn(),
    deleteAgent: vi.fn(),
    writeTool: vi.fn(),
    getTool: vi.fn(),
    listTools: vi.fn(),
    deleteTool: vi.fn(),
    runMigrations: vi.fn(),
    getSchemaVersion: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as DatabaseAdapter;
}

describe('GovernanceMiddleware — Dry-Run', () => {
  let governance: GovernanceMiddleware;

  beforeEach(() => {
    governance = new GovernanceMiddleware({ logger: silentLogger });
  });

  it('should return allowed for matching allow rule', () => {
    const result = governance.evaluateDryRun(
      { agentId: 'agent-1', tool: 'read_file' },
      makePolicy(),
    );

    expect(result.allowed).toBe(true);
    expect(result.traceId).toBeDefined();
    expect(result.appliedRules).toHaveLength(1);
    expect(result.appliedRules[0].effect).toBe('allow');
  });

  it('should return denied for matching deny rule', () => {
    const result = governance.evaluateDryRun(
      { agentId: 'agent-1', tool: 'file_write', params: { path: '/etc/passwd' } },
      makeDenyPolicy(),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Forbidden path');
  });

  it('should respect specificity ordering', () => {
    const policy = makePolicy({
      rules: [
        { tool: '*', effect: 'allow' },
        { tool: 'file_write', effect: 'deny', reason: 'No file writes' },
      ],
    });

    const result = governance.evaluateDryRun(
      { agentId: 'agent-1', tool: 'file_write' },
      policy,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No file writes');
  });

  it('should NOT check kill-switch even when active', () => {
    governance.emergencyStop('test');

    const result = governance.evaluateDryRun(
      { agentId: 'agent-1', tool: 'read_file' },
      makePolicy(),
    );

    // Dry-run ignores kill-switch
    expect(result.allowed).toBe(true);

    governance.resetKillSwitch();
  });

  it('should NOT emit events', () => {
    const events: unknown[] = [];
    governance.on('tool_call.allowed', (e) => events.push(e));
    governance.on('tool_call.denied', (e) => events.push(e));

    governance.evaluateDryRun(
      { agentId: 'agent-1', tool: 'read_file' },
      makePolicy(),
    );

    expect(events).toHaveLength(0);
  });

  it('should throw GovernanceError for invalid request', () => {
    expect(() =>
      governance.evaluateDryRun(
        { agentId: '', tool: 'read_file' },
        makePolicy(),
      ),
    ).toThrow(GovernanceError);
  });

  it('should throw GovernanceError for invalid policy', () => {
    expect(() =>
      governance.evaluateDryRun(
        { agentId: 'agent-1', tool: 'read_file' },
        { name: '', version: '', rules: [], createdAt: '', updatedAt: '' },
      ),
    ).toThrow(GovernanceError);
  });

  it('should generate traceId when not provided', () => {
    const result = governance.evaluateDryRun(
      { agentId: 'agent-1', tool: 'read_file' },
      makePolicy(),
    );

    expect(result.traceId).toMatch(/^[a-f0-9]{32}$/);
  });

  it('should use provided traceId', () => {
    const traceId = 'a'.repeat(32);
    const result = governance.evaluateDryRun(
      { agentId: 'agent-1', tool: 'read_file', traceId },
      makePolicy(),
    );

    expect(result.traceId).toBe(traceId);
  });

  it('should work without DB (pure in-memory)', () => {
    // No DB passed to constructor
    const gov = new GovernanceMiddleware({ logger: silentLogger });

    const result = gov.evaluateDryRun(
      { agentId: 'agent-1', tool: 'read_file' },
      makePolicy(),
    );

    expect(result.allowed).toBe(true);
  });
});

describe('GovernanceMiddleware — Policy Versioning', () => {
  it('should delegate getPolicyHistory to DB', async () => {
    const versions = [makeVersion({ id: 2, version: '2.0' }), makeVersion()];
    const db = mockDb({ getPolicyHistory: vi.fn().mockResolvedValue(versions) });
    const governance = new GovernanceMiddleware({ logger: silentLogger, db });

    const history = await governance.getPolicyHistory('test-policy');

    expect(history).toEqual(versions);
    expect(db.getPolicyHistory).toHaveBeenCalledWith('test-policy');
  });

  it('should delegate getPolicyVersion to DB', async () => {
    const version = makeVersion();
    const db = mockDb({ getPolicyVersion: vi.fn().mockResolvedValue(version) });
    const governance = new GovernanceMiddleware({ logger: silentLogger, db });

    const result = await governance.getPolicyVersion('test-policy', 1);

    expect(result).toEqual(version);
    expect(db.getPolicyVersion).toHaveBeenCalledWith('test-policy', 1);
  });

  it('should throw GovernanceError without DB for getPolicyHistory', async () => {
    const governance = new GovernanceMiddleware({ logger: silentLogger });

    await expect(governance.getPolicyHistory('test-policy')).rejects.toThrow(GovernanceError);
  });

  it('should throw GovernanceError without DB for getPolicyVersion', async () => {
    const governance = new GovernanceMiddleware({ logger: silentLogger });

    await expect(governance.getPolicyVersion('test-policy', 1)).rejects.toThrow(GovernanceError);
  });

  it('should throw GovernanceError without DB for rollbackPolicy', async () => {
    const governance = new GovernanceMiddleware({ logger: silentLogger });

    await expect(governance.rollbackPolicy('test-policy', 1)).rejects.toThrow(GovernanceError);
  });

  describe('rollbackPolicy', () => {
    it('should restore version and write back to DB', async () => {
      const version = makeVersion({
        version: '1.0',
        rules: [{ tool: 'file_read', effect: 'allow' }],
        agentId: 'agent-1',
      });
      const db = mockDb({
        getPolicyVersion: vi.fn().mockResolvedValue(version),
        writePolicy: vi.fn(),
      });
      const governance = new GovernanceMiddleware({ logger: silentLogger, db });

      const policy = await governance.rollbackPolicy('test-policy', 1);

      expect(policy.name).toBe('test-policy');
      expect(policy.version).toBe('1.0');
      expect(policy.agentId).toBe('agent-1');
      expect(policy.rules).toEqual([{ tool: 'file_read', effect: 'allow' }]);
      expect(db.writePolicy).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test-policy',
        version: '1.0',
      }));
    });

    it('should throw GovernanceError for nonexistent version', async () => {
      const db = mockDb({
        getPolicyVersion: vi.fn().mockResolvedValue(null),
      });
      const governance = new GovernanceMiddleware({ logger: silentLogger, db });

      await expect(governance.rollbackPolicy('test-policy', 99999))
        .rejects.toThrow(GovernanceError);
    });

    it('should emit policy.updated event with rollback action', async () => {
      const version = makeVersion();
      const db = mockDb({
        getPolicyVersion: vi.fn().mockResolvedValue(version),
        writePolicy: vi.fn(),
      });
      const governance = new GovernanceMiddleware({ logger: silentLogger, db });

      const events: unknown[] = [];
      governance.on('policy.updated', (e) => events.push(e));

      await governance.rollbackPolicy('test-policy', 1);

      // Wait for async event dispatch
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events).toHaveLength(1);
      expect((events[0] as { data: { action: string } }).data.action).toBe('rollback');
    });
  });
});

describe('GovernanceMiddleware — Dry-Run structural', () => {
  it('evaluateDryRun should NOT call emitEvent', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      'packages/core/src/lifecycle/governance-middleware.ts',
      'utf-8',
    );

    // Extract the evaluateDryRun method body
    const methodStart = source.indexOf('evaluateDryRun(');
    const methodEnd = source.indexOf('\n  }', methodStart);
    const methodBody = source.slice(methodStart, methodEnd);

    // Must NOT contain emitEvent
    expect(methodBody).not.toContain('emitEvent');
    // Must NOT contain killSwitch
    expect(methodBody).not.toContain('killSwitch');
  });
});
