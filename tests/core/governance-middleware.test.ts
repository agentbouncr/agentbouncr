import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import {
  GovernanceMiddleware,
  GovernanceError,
} from '@agentbouncr/core';
import type {
  GovernanceMiddlewareOptions,
  Policy,
  AgentConfig,
  AgentStatus,
  AgentRunStatus,
  DatabaseAdapter,
  AuditEventInput,
  AuditFilter,
  AuditEvent,
  AuditChainVerificationResult,
  GovernanceEvent,
  ApprovalRequest,
  ApprovalRequestInput,
  ApprovalFilter,
  ApprovalResolution,
} from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    name: 'test-policy',
    version: '1.0',
    rules: [
      { tool: 'allowed_tool', effect: 'allow' },
      { tool: 'denied_tool', effect: 'deny', reason: 'Forbidden' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Internal store for mock approval requests, used by makeMockDb. */
let mockApprovalStore: Map<string, ApprovalRequest>;

function makeMockDb(_overrides?: Partial<DatabaseAdapter>): DatabaseAdapter {
  mockApprovalStore = new Map();
  let approvalCounter = 0;

  return {
    writeAuditEvent: vi.fn<(event: AuditEventInput) => Promise<void>>().mockResolvedValue(undefined),
    queryAuditEvents: vi.fn<(filter: AuditFilter) => Promise<AuditEvent[]>>().mockResolvedValue([]),
    getLatestAuditHash: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    verifyAuditChain: vi.fn<() => Promise<AuditChainVerificationResult>>().mockResolvedValue({ valid: true, totalEvents: 0, verifiedEvents: 0 }),
    exportAuditEvents: vi.fn<(filter: AuditFilter, stream: NodeJS.WritableStream) => Promise<void>>().mockResolvedValue(undefined),
    writePolicy: vi.fn<(policy: Policy) => Promise<void>>().mockResolvedValue(undefined),
    getActivePolicy: vi.fn<(agentId: string) => Promise<Policy | null>>().mockResolvedValue(null),
    listPolicies: vi.fn<() => Promise<Policy[]>>().mockResolvedValue([]),
    getPolicyByName: vi.fn<(name: string) => Promise<Policy | null>>().mockResolvedValue(null),
    deletePolicy: vi.fn<(name: string) => Promise<boolean>>().mockResolvedValue(true),
    registerAgent: vi.fn<(config: AgentConfig) => Promise<string>>().mockImplementation((config) => Promise.resolve(config.agentId)),
    getAgentStatus: vi.fn<(agentId: string) => Promise<AgentStatus | null>>().mockResolvedValue(null),
    updateAgentStatus: vi.fn<(agentId: string, status: AgentRunStatus) => Promise<void>>().mockResolvedValue(undefined),
    listAgents: vi.fn<() => Promise<AgentStatus[]>>().mockResolvedValue([]),
    deleteAgent: vi.fn<(agentId: string) => Promise<boolean>>().mockResolvedValue(true),
    runMigrations: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getSchemaVersion: vi.fn<() => Promise<number>>().mockResolvedValue(1),
    transaction: vi.fn(),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    // Approval methods
    createApprovalRequest: vi.fn<(input: ApprovalRequestInput) => Promise<ApprovalRequest>>()
      .mockImplementation((input) => {
        approvalCounter++;
        const approval: ApprovalRequest = {
          id: `approval-${approvalCounter}`,
          agentId: input.agentId,
          tool: input.tool,
          params: input.params,
          traceId: input.traceId,
          policyName: input.policyName,
          ruleName: input.ruleName,
          status: 'pending',
          deadline: input.deadline,
          createdAt: new Date().toISOString(),
          tenantId: 'default',
        };
        mockApprovalStore.set(approval.id, approval);
        return Promise.resolve(approval);
      }),
    getApprovalRequest: vi.fn<(id: string) => Promise<ApprovalRequest | null>>()
      .mockImplementation((id) => Promise.resolve(mockApprovalStore.get(id) ?? null)),
    listApprovalRequests: vi.fn<(filter?: ApprovalFilter) => Promise<ApprovalRequest[]>>()
      .mockImplementation((filter) => {
        let results = Array.from(mockApprovalStore.values());
        if (filter?.agentId) results = results.filter((r) => r.agentId === filter.agentId);
        if (filter?.status) results = results.filter((r) => r.status === filter.status);
        return Promise.resolve(results);
      }),
    resolveApprovalRequest: vi.fn<(id: string, resolution: ApprovalResolution) => Promise<boolean>>()
      .mockImplementation((id, resolution) => {
        const approval = mockApprovalStore.get(id);
        if (!approval || approval.status !== 'pending') return Promise.resolve(false);
        approval.status = resolution.status;
        approval.approver = resolution.approver;
        approval.comment = resolution.comment;
        approval.resolvedAt = new Date().toISOString();
        return Promise.resolve(true);
      }),
  };
}

function makeOptions(overrides?: Partial<GovernanceMiddlewareOptions>): GovernanceMiddlewareOptions {
  return {
    logger: silentLogger,
    ...overrides,
  };
}

describe('GovernanceMiddleware', () => {
  describe('evaluate() — Zero-Config', () => {
    it('should allow all tool calls with no policy (default allow-all)', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'any_tool',
        params: {},
      });
      expect(result.allowed).toBe(true);
      expect(result.traceId).toBeDefined();
    });

    it('should work with zero arguments (full zero-config)', async () => {
      // This mimics: const governance = new GovernanceMiddleware();
      // We pass silentLogger to avoid console output in tests
      const mw = new GovernanceMiddleware({ logger: silentLogger });
      const result = await mw.evaluate({
        agentId: 'a',
        tool: 'x',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('evaluate() — with inline policy', () => {
    it('should allow when policy allows', async () => {
      const mw = new GovernanceMiddleware(makeOptions({ policy: makePolicy() }));
      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'allowed_tool',
      });
      expect(result.allowed).toBe(true);
    });

    it('should deny when policy denies', async () => {
      const mw = new GovernanceMiddleware(makeOptions({ policy: makePolicy() }));
      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'denied_tool',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Forbidden');
    });
  });

  describe('evaluate() — with DB policy', () => {
    it('should load policy from DB when no inline policy', async () => {
      const db = makeMockDb();
      (db.getActivePolicy as ReturnType<typeof vi.fn>).mockResolvedValue(makePolicy());

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'denied_tool',
      });

      expect(result.allowed).toBe(false);
      expect(db.getActivePolicy).toHaveBeenCalledWith('test-agent');
    });

    it('should prefer inline policy over DB policy', async () => {
      const db = makeMockDb();
      (db.getActivePolicy as ReturnType<typeof vi.fn>).mockResolvedValue(
        makePolicy({ rules: [{ tool: '*', effect: 'deny', reason: 'DB denies all' }] }),
      );

      // Inline policy allows all
      const inlinePolicy = makePolicy({ rules: [{ tool: '*', effect: 'allow' }] });
      const mw = new GovernanceMiddleware(makeOptions({ db, policy: inlinePolicy }));

      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'any_tool',
      });

      expect(result.allowed).toBe(true);
      // DB should NOT be queried when inline policy exists
      expect(db.getActivePolicy).not.toHaveBeenCalled();
    });

    it('should fall back to default allow-all when DB returns null', async () => {
      const db = makeMockDb();
      (db.getActivePolicy as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'any_tool',
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('evaluate() — fail-secure on DB error', () => {
    it('should deny when DB.getActivePolicy throws (fail-secure)', async () => {
      const db = makeMockDb();
      (db.getActivePolicy as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB connection lost'),
      );

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'any_tool',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('fail-secure');
    });

    it('should emit tool_call.denied on DB error', async () => {
      const db = makeMockDb();
      (db.getActivePolicy as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB connection lost'),
      );

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const events: GovernanceEvent[] = [];
      mw.on('tool_call.denied', (event) => { events.push(event); });

      await mw.evaluate({ agentId: 'a', tool: 'x' });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toContain('fail-secure');
    });
  });

  describe('evaluate() — Kill-Switch', () => {
    it('should deny when kill-switch is active', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      mw.emergencyStop('Test emergency');

      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'allowed_tool',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Kill-Switch');
    });

    it('should deny even with allow-all policy when kill-switch is active', async () => {
      const mw = new GovernanceMiddleware(makeOptions({
        policy: makePolicy({ rules: [{ tool: '*', effect: 'allow' }] }),
      }));
      mw.emergencyStop('Emergency');

      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'allowed_tool',
      });

      expect(result.allowed).toBe(false);
    });

    it('should allow again after kill-switch reset', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      mw.emergencyStop('Emergency');
      mw.resetKillSwitch();

      const result = await mw.evaluate({
        agentId: 'test-agent',
        tool: 'any_tool',
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('evaluate() — events', () => {
    it('should emit tool_call.allowed on allow', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const events: GovernanceEvent[] = [];
      mw.on('tool_call.allowed', (event) => { events.push(event); });

      await mw.evaluate({ agentId: 'a', tool: 'x' });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_call.allowed');
      expect(events[0].agentId).toBe('a');
    });

    it('should emit tool_call.denied on deny', async () => {
      const mw = new GovernanceMiddleware(makeOptions({ policy: makePolicy() }));
      const events: GovernanceEvent[] = [];
      mw.on('tool_call.denied', (event) => { events.push(event); });

      await mw.evaluate({ agentId: 'a', tool: 'denied_tool' });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_call.denied');
    });

    it('should emit tool_call.denied on kill-switch deny', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const events: GovernanceEvent[] = [];
      mw.on('tool_call.denied', (event) => { events.push(event); });

      mw.emergencyStop('Emergency');
      await mw.evaluate({ agentId: 'a', tool: 'x' });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.killSwitch).toBe(true);
    });
  });

  describe('Agent CRUD', () => {
    let db: DatabaseAdapter;
    let mw: GovernanceMiddleware;

    beforeEach(() => {
      db = makeMockDb();
      mw = new GovernanceMiddleware(makeOptions({ db }));
    });

    it('should register agent via DB', async () => {
      const config: AgentConfig = {
        agentId: 'test-agent',
        name: 'Test Agent',
        allowedTools: ['tool_a'],
      };
      const id = await mw.registerAgent(config);
      expect(id).toBe('test-agent');
      expect(db.registerAgent).toHaveBeenCalledWith(config);
    });

    it('should emit agent.config_changed on register', async () => {
      const events: GovernanceEvent[] = [];
      mw.on('agent.config_changed', (event) => { events.push(event); });

      await mw.registerAgent({ agentId: 'a', name: 'A', allowedTools: [] });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('a');
      expect(events[0].data.action).toBe('registered');
    });

    it('should start agent via DB', async () => {
      await mw.startAgent('test-agent');
      expect(db.updateAgentStatus).toHaveBeenCalledWith('test-agent', 'running');
    });

    it('should emit agent.started on start', async () => {
      const events: GovernanceEvent[] = [];
      mw.on('agent.started', (event) => { events.push(event); });

      await mw.startAgent('test-agent');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('test-agent');
    });

    it('should stop agent via DB', async () => {
      await mw.stopAgent('test-agent', 'Maintenance');
      expect(db.updateAgentStatus).toHaveBeenCalledWith('test-agent', 'stopped');
    });

    it('should emit agent.stopped on stop', async () => {
      const events: GovernanceEvent[] = [];
      mw.on('agent.stopped', (event) => { events.push(event); });

      await mw.stopAgent('test-agent', 'Maintenance');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toBe('Maintenance');
    });

    it('should get agent status via DB', async () => {
      const mockStatus: AgentStatus = {
        agentId: 'test-agent',
        name: 'Test',
        status: 'running',
        registeredAt: '2026-01-01T00:00:00Z',
      };
      (db.getAgentStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockStatus);

      const status = await mw.getAgentStatus('test-agent');
      expect(status).toEqual(mockStatus);
    });

    it('should list agents via DB', async () => {
      const mockAgents: AgentStatus[] = [
        { agentId: 'a', name: 'A', status: 'running', registeredAt: '2026-01-01T00:00:00Z' },
        { agentId: 'b', name: 'B', status: 'stopped', registeredAt: '2026-01-02T00:00:00Z' },
      ];
      (db.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue(mockAgents);

      const agents = await mw.listAgents();
      expect(agents).toHaveLength(2);
    });

    it('should delete agent via DB', async () => {
      await mw.deleteAgent('test-agent');
      expect(db.deleteAgent).toHaveBeenCalledWith('test-agent');
    });

    it('should emit agent.config_changed on delete', async () => {
      const events: GovernanceEvent[] = [];
      mw.on('agent.config_changed', (event) => { events.push(event); });

      await mw.deleteAgent('test-agent');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('test-agent');
      expect(events[0].data.action).toBe('deleted');
    });

    it('should return true when agent was deleted', async () => {
      const result = await mw.deleteAgent('test-agent');
      expect(result).toBe(true);
    });

    it('should return false and not emit event when agent did not exist', async () => {
      (db.deleteAgent as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const events: GovernanceEvent[] = [];
      mw.on('agent.config_changed', (event) => { events.push(event); });

      const result = await mw.deleteAgent('nonexistent');

      expect(result).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(0);
    });
  });

  describe('CRUD without DB — GovernanceError', () => {
    let mw: GovernanceMiddleware;

    beforeEach(() => {
      mw = new GovernanceMiddleware(makeOptions());
    });

    it('should throw GovernanceError for registerAgent without DB', async () => {
      await expect(mw.registerAgent({ agentId: 'a', name: 'A', allowedTools: [] }))
        .rejects.toThrow(GovernanceError);
    });

    it('should throw with code DATABASE_REQUIRED', async () => {
      try {
        await mw.startAgent('a');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('DATABASE_REQUIRED');
        expect((err as GovernanceError).category).toBe('config_error');
      }
    });

    it('should throw for stopAgent without DB', async () => {
      await expect(mw.stopAgent('a')).rejects.toThrow(GovernanceError);
    });

    it('should throw for getAgentStatus without DB', async () => {
      await expect(mw.getAgentStatus('a')).rejects.toThrow(GovernanceError);
    });

    it('should throw for listAgents without DB', async () => {
      await expect(mw.listAgents()).rejects.toThrow(GovernanceError);
    });

    it('should throw for deleteAgent without DB', async () => {
      await expect(mw.deleteAgent('a')).rejects.toThrow(GovernanceError);
    });
  });

  describe('Kill-Switch integration', () => {
    it('should report isKillSwitchActive correctly', () => {
      const mw = new GovernanceMiddleware(makeOptions());
      expect(mw.isKillSwitchActive()).toBe(false);
      mw.emergencyStop('Test');
      expect(mw.isKillSwitchActive()).toBe(true);
      mw.resetKillSwitch();
      expect(mw.isKillSwitchActive()).toBe(false);
    });

    it('should emit killswitch.activated when emergencyStop is called', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const events: GovernanceEvent[] = [];
      mw.on('killswitch.activated', (event) => { events.push(event); });

      mw.emergencyStop('Critical failure');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toBe('Critical failure');
    });

    it('should return KillSwitchStatus via getKillSwitchStatus()', () => {
      const mw = new GovernanceMiddleware(makeOptions());

      const status1 = mw.getKillSwitchStatus();
      expect(status1.active).toBe(false);
      expect(status1.activatedAt).toBeUndefined();
      expect(status1.reason).toBeUndefined();

      mw.emergencyStop('Test reason');

      const status2 = mw.getKillSwitchStatus();
      expect(status2.active).toBe(true);
      expect(status2.activatedAt).toBeDefined();
      expect(status2.reason).toBe('Test reason');
    });
  });

  describe('setPolicy()', () => {
    it('should update policy for future evaluate calls', async () => {
      const mw = new GovernanceMiddleware(makeOptions());

      // Default: allow-all
      const r1 = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(r1.allowed).toBe(true);

      // Set restrictive policy
      mw.setPolicy(makePolicy({ rules: [{ tool: '*', effect: 'deny', reason: 'Locked' }] }));

      const r2 = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(r2.allowed).toBe(false);
      expect(r2.reason).toBe('Locked');
    });
  });

  describe('Policy CRUD', () => {
    let db: DatabaseAdapter;
    let mw: GovernanceMiddleware;

    beforeEach(() => {
      db = makeMockDb();
      mw = new GovernanceMiddleware(makeOptions({ db }));
    });

    it('should write policy via DB and emit policy.updated', async () => {
      const events: GovernanceEvent[] = [];
      mw.on('policy.updated', (event) => { events.push(event); });

      const policy = makePolicy();
      await mw.writePolicy(policy);

      expect(db.writePolicy).toHaveBeenCalledWith(policy);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.policyName).toBe('test-policy');
    });

    it('should throw INVALID_POLICY for bad writePolicy input', async () => {
      try {
        await mw.writePolicy({ name: '', version: '1.0', rules: [], createdAt: '', updatedAt: '' } as never);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('INVALID_POLICY');
      }
    });

    it('should list policies via DB', async () => {
      const policies = [makePolicy({ name: 'p1' }), makePolicy({ name: 'p2' })];
      (db.listPolicies as ReturnType<typeof vi.fn>).mockResolvedValue(policies);

      const result = await mw.listPolicies();
      expect(result).toHaveLength(2);
      expect(db.listPolicies).toHaveBeenCalled();
    });

    it('should get policy by name via DB', async () => {
      const policy = makePolicy({ name: 'my-policy' });
      (db.getPolicyByName as ReturnType<typeof vi.fn>).mockResolvedValue(policy);

      const result = await mw.getPolicyByName('my-policy');
      expect(result).toEqual(policy);
      expect(db.getPolicyByName).toHaveBeenCalledWith('my-policy');
    });

    it('should return null for non-existent policy', async () => {
      const result = await mw.getPolicyByName('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete policy via DB and emit policy.deleted', async () => {
      const events: GovernanceEvent[] = [];
      mw.on('policy.deleted', (event) => { events.push(event); });

      const result = await mw.deletePolicy('test-policy');
      expect(result).toBe(true);
      expect(db.deletePolicy).toHaveBeenCalledWith('test-policy');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.policyName).toBe('test-policy');
    });

    it('should not emit policy.deleted when policy did not exist', async () => {
      (db.deletePolicy as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const events: GovernanceEvent[] = [];
      mw.on('policy.deleted', (event) => { events.push(event); });

      const result = await mw.deletePolicy('nonexistent');
      expect(result).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(0);
    });

    it('should throw DATABASE_REQUIRED for policy CRUD without DB', async () => {
      const noDB = new GovernanceMiddleware(makeOptions());
      await expect(noDB.writePolicy(makePolicy())).rejects.toThrow(GovernanceError);
      await expect(noDB.listPolicies()).rejects.toThrow(GovernanceError);
      await expect(noDB.getPolicyByName('x')).rejects.toThrow(GovernanceError);
      await expect(noDB.deletePolicy('x')).rejects.toThrow(GovernanceError);
    });
  });

  describe('on() / off()', () => {
    it('should register and unregister event listeners', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const events: GovernanceEvent[] = [];
      const listener = (event: GovernanceEvent) => { events.push(event); };

      mw.on('tool_call.allowed', listener);
      await mw.evaluate({ agentId: 'a', tool: 'x' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);

      mw.off('tool_call.allowed', listener);
      await mw.evaluate({ agentId: 'a', tool: 'x' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Should still be 1 — listener was removed
      expect(events).toHaveLength(1);
    });
  });

  describe('Zod input validation', () => {
    it('should throw GovernanceError for invalid EvaluateRequest', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      // Empty agentId
      await expect(mw.evaluate({ agentId: '', tool: 'x' }))
        .rejects.toThrow(GovernanceError);

      // Empty tool
      await expect(mw.evaluate({ agentId: 'a', tool: '' }))
        .rejects.toThrow(GovernanceError);
    });

    it('should throw INVALID_REQUEST code for bad evaluate input', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      try {
        await mw.evaluate({ agentId: '', tool: 'x' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('INVALID_REQUEST');
        expect((err as GovernanceError).category).toBe('config_error');
      }
    });

    it('should throw GovernanceError for invalid AgentConfig', async () => {
      const db = makeMockDb();
      const mw = new GovernanceMiddleware(makeOptions({ db }));
      // Empty agentId
      await expect(mw.registerAgent({ agentId: '', name: 'A', allowedTools: [] }))
        .rejects.toThrow(GovernanceError);

      // Empty name
      await expect(mw.registerAgent({ agentId: 'a', name: '', allowedTools: [] }))
        .rejects.toThrow(GovernanceError);
    });

    it('should throw INVALID_CONFIG code for bad registerAgent input', async () => {
      const db = makeMockDb();
      const mw = new GovernanceMiddleware(makeOptions({ db }));
      try {
        await mw.registerAgent({ agentId: '', name: 'A', allowedTools: [] });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('INVALID_CONFIG');
      }
    });

    it('should throw GovernanceError for invalid Policy in setPolicy', () => {
      const mw = new GovernanceMiddleware(makeOptions());
      expect(() => mw.setPolicy({ name: '', version: '1.0', rules: [], createdAt: '', updatedAt: '' } as never))
        .toThrow(GovernanceError);
    });

    it('should throw INVALID_POLICY code for bad setPolicy input', () => {
      const mw = new GovernanceMiddleware(makeOptions());
      try {
        mw.setPolicy({ name: '', version: '1.0', rules: [], createdAt: '', updatedAt: '' } as never);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('INVALID_POLICY');
      }
    });
  });

  describe('Kill-Switch + DB-error precedence (F-02)', () => {
    it('should deny via kill-switch even when DB would throw', async () => {
      const db = makeMockDb();
      (db.getActivePolicy as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB down'));

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      mw.emergencyStop('Emergency');

      const result = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Kill-Switch');
      // DB should NOT even be queried
      expect(db.getActivePolicy).not.toHaveBeenCalled();
    });
  });

  describe('forTenant()', () => {
    it('should return scoped middleware when DB supports forTenant', () => {
      const scopedDb = makeMockDb();
      const db = makeMockDb();
      db.forTenant = vi.fn().mockReturnValue(scopedDb);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scoped = mw.forTenant('tenant-a');

      expect(scoped).not.toBe(mw);
      expect(db.forTenant).toHaveBeenCalledWith('tenant-a');
    });

    it('should return identity when DB.forTenant returns same adapter (same tenant)', () => {
      const db = makeMockDb();
      db.forTenant = vi.fn().mockReturnValue(db); // same ref

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scoped = mw.forTenant('default');

      expect(scoped).toBe(mw);
    });

    it('should return identity when DB has no forTenant method (e.g. SQLite)', () => {
      const db = makeMockDb();
      // No forTenant on db → mw returns itself

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scoped = mw.forTenant('tenant-a');

      expect(scoped).toBe(mw);
    });

    it('should isolate kill-switch state between tenants', () => {
      const scopedDbA = makeMockDb();
      const scopedDbB = makeMockDb();
      const db = makeMockDb();
      db.forTenant = vi.fn((id: string) => id === 'tenant-a' ? scopedDbA : scopedDbB);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scopedA = mw.forTenant('tenant-a');
      const scopedB = mw.forTenant('tenant-b');

      scopedA.emergencyStop('Tenant A emergency');
      expect(scopedA.isKillSwitchActive()).toBe(true);
      expect(scopedB.isKillSwitchActive()).toBe(false);
      expect(mw.isKillSwitchActive()).toBe(false); // global unaffected

      scopedA.resetKillSwitch();
      expect(scopedA.isKillSwitchActive()).toBe(false);
    });

    it('should return tenant-specific status from scoped middleware', () => {
      const scopedDbA = makeMockDb();
      const db = makeMockDb();
      db.forTenant = vi.fn(() => scopedDbA);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scopedA = mw.forTenant('tenant-a');

      scopedA.emergencyStop('Tenant A down');

      const statusA = scopedA.getKillSwitchStatus();
      expect(statusA.active).toBe(true);
      expect(statusA.reason).toBe('Tenant A down');

      const statusGlobal = mw.getKillSwitchStatus();
      expect(statusGlobal.active).toBe(false);
    });

    it('should deny evaluate() only for the activated tenant', async () => {
      const scopedDbA = makeMockDb();
      const scopedDbB = makeMockDb();
      const db = makeMockDb();
      db.forTenant = vi.fn((id: string) => id === 'tenant-a' ? scopedDbA : scopedDbB);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scopedA = mw.forTenant('tenant-a');
      const scopedB = mw.forTenant('tenant-b');

      scopedA.emergencyStop('Emergency');

      const resultA = await scopedA.evaluate({ agentId: 'agent', tool: 'test', params: {} });
      expect(resultA.allowed).toBe(false);
      expect(resultA.reason).toContain('Kill-Switch');

      const resultB = await scopedB.evaluate({ agentId: 'agent', tool: 'test', params: {} });
      expect(resultB.allowed).toBe(true); // tenant-b not affected
    });

    it('should use scoped DB for agent CRUD operations', async () => {
      const scopedDb = makeMockDb();
      const db = makeMockDb();
      db.forTenant = vi.fn().mockReturnValue(scopedDb);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scoped = mw.forTenant('tenant-a');

      await scoped.registerAgent({ agentId: 'a', name: 'A', allowedTools: [] });
      expect(scopedDb.registerAgent).toHaveBeenCalled();
      // Parent DB should NOT have been called
      expect(db.registerAgent).not.toHaveBeenCalled();
    });

    it('should return identity when no DB is configured (zero-config)', () => {
      const mw = new GovernanceMiddleware(makeOptions()); // no db
      const scoped = mw.forTenant('tenant-a');
      expect(scoped).toBe(mw);
    });

    it('should not propagate scoped setPolicy() to parent (policy isolation)', async () => {
      const scopedDb = makeMockDb();
      const db = makeMockDb();
      db.forTenant = vi.fn().mockReturnValue(scopedDb);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scoped = mw.forTenant('tenant-a');

      scoped.setPolicy(makePolicy({ rules: [{ tool: '*', effect: 'deny', reason: 'Tenant locked' }] }));

      // Parent must still be allow-all
      const parentResult = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(parentResult.allowed).toBe(true);

      // Scoped must deny
      const scopedResult = await scoped.evaluate({ agentId: 'a', tool: 'x' });
      expect(scopedResult.allowed).toBe(false);
    });

    it('should emit events from scoped middleware to parent event listeners', async () => {
      const scopedDb = makeMockDb();
      const db = makeMockDb();
      db.forTenant = vi.fn().mockReturnValue(scopedDb);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const events: GovernanceEvent[] = [];
      mw.on('tool_call.allowed', (e) => events.push(e));

      const scoped = mw.forTenant('tenant-a');
      await scoped.evaluate({ agentId: 'a', tool: 'x' });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
    });

    it('should use scoped DB for evaluate with DB policy', async () => {
      const scopedDb = makeMockDb();
      (scopedDb.getActivePolicy as ReturnType<typeof vi.fn>).mockResolvedValue(
        makePolicy({ rules: [{ tool: '*', effect: 'deny', reason: 'Tenant deny' }] }),
      );
      const db = makeMockDb();
      db.forTenant = vi.fn().mockReturnValue(scopedDb);

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const scoped = mw.forTenant('tenant-a');

      const result = await scoped.evaluate({ agentId: 'a', tool: 'x' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Tenant deny');
      expect(scopedDb.getActivePolicy).toHaveBeenCalled();
    });
  });

  describe('Approval Workflows', () => {
    function makeApprovalPolicy(): Policy {
      return {
        name: 'approval-policy',
        version: '1.0',
        rules: [
          { tool: 'dangerous_tool', effect: 'allow', requireApproval: true },
          { tool: 'safe_tool', effect: 'allow' },
          { tool: 'blocked_tool', effect: 'deny', reason: 'Not allowed', requireApproval: true },
        ],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
    }

    describe('evaluate() with requireApproval', () => {
      it('should return requiresApproval when allowed rule has requireApproval', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const result = await mw.evaluate({
          agentId: 'agent-1',
          tool: 'dangerous_tool',
          params: { target: '/etc/passwd' },
        });

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.approvalId).toBeDefined();
        expect(result.deadline).toBeDefined();
        expect(result.reason).toContain('Approval required');
      });

      it('should create approval request in DB', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        await mw.evaluate({
          agentId: 'agent-1',
          tool: 'dangerous_tool',
        });

        expect(db.createApprovalRequest).toHaveBeenCalledTimes(1);
        const call = (db.createApprovalRequest as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.agentId).toBe('agent-1');
        expect(call.tool).toBe('dangerous_tool');
        expect(call.policyName).toBe('approval-policy');
      });

      it('should emit approval.requested event', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));
        const events: GovernanceEvent[] = [];
        mw.on('approval.requested', (e) => events.push(e));

        await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(events).toHaveLength(1);
        expect(events[0].data.tool).toBe('dangerous_tool');
        expect(events[0].data.approvalId).toBeDefined();
        expect(events[0].data.deadline).toBeDefined();
      });

      it('should NOT emit tool_call.allowed for requireApproval', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));
        const allowedEvents: GovernanceEvent[] = [];
        mw.on('tool_call.allowed', (e) => allowedEvents.push(e));

        await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(allowedEvents).toHaveLength(0);
      });

      it('should NOT emit tool_call.denied for requireApproval (F-02)', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));
        const deniedEvents: GovernanceEvent[] = [];
        mw.on('tool_call.denied', (e) => deniedEvents.push(e));

        await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(deniedEvents).toHaveLength(0);
      });

      it('should deny normally when denied rule has requireApproval', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const result = await mw.evaluate({
          agentId: 'agent-1',
          tool: 'blocked_tool',
        });

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBeUndefined();
        expect(result.approvalId).toBeUndefined();
        expect(result.reason).toBe('Not allowed');
        expect(db.createApprovalRequest).not.toHaveBeenCalled();
      });

      it('should allow normally when rule has no requireApproval', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const result = await mw.evaluate({
          agentId: 'agent-1',
          tool: 'safe_tool',
        });

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBeUndefined();
        expect(db.createApprovalRequest).not.toHaveBeenCalled();
      });

      it('should deny in fail-secure mode when no DB approval support', async () => {
        // Middleware with policy but no DB
        const mw = new GovernanceMiddleware(makeOptions({
          policy: makeApprovalPolicy(),
        }));

        const result = await mw.evaluate({
          agentId: 'agent-1',
          tool: 'dangerous_tool',
        });

        // Fail-secure: denies when approval infra unavailable
        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('approval infrastructure not available');
      });

      it('should propagate error when createApprovalRequest fails (F-03)', async () => {
        const db = makeMockDb();
        (db.createApprovalRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new Error('DB write failed'),
        );
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));
        const allowedEvents: GovernanceEvent[] = [];
        mw.on('tool_call.allowed', (e) => allowedEvents.push(e));

        await expect(mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' }))
          .rejects.toThrow('DB write failed');

        // tool_call.allowed must NOT be emitted — fail-secure
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(allowedEvents).toHaveLength(0);
      });

      it('should use custom approval timeout', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware({
          ...makeOptions({ db, policy: makeApprovalPolicy() }),
          approvalTimeoutSeconds: 60, // 1 minute
        });

        const before = Date.now();
        const result = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        const deadline = new Date(result.deadline!).getTime();

        // Deadline should be ~60s from now (allow 5s tolerance)
        expect(deadline - before).toBeGreaterThan(55_000);
        expect(deadline - before).toBeLessThan(65_000);
      });
    });

    describe('resolveApproval()', () => {
      it('should approve a pending request', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        const { resolved, approval } = await mw.resolveApproval(evalResult.approvalId!, {
          status: 'approved',
          approver: 'admin@example.com',
          comment: 'LGTM',
        });

        expect(resolved).toBe(true);
        expect(approval).toBeDefined();
        expect(approval!.status).toBe('approved');
        expect(approval!.approver).toBe('admin@example.com');
      });

      it('should reject a pending request', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        const { resolved, approval } = await mw.resolveApproval(evalResult.approvalId!, {
          status: 'rejected',
          approver: 'ciso@example.com',
          comment: 'Too risky',
        });

        expect(resolved).toBe(true);
        expect(approval!.status).toBe('rejected');
      });

      it('should return resolved=false for already resolved request', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await mw.resolveApproval(evalResult.approvalId!, {
          status: 'approved', approver: 'first',
        });
        const second = await mw.resolveApproval(evalResult.approvalId!, {
          status: 'rejected', approver: 'second',
        });

        expect(second.resolved).toBe(false);
      });

      it('should emit approval.granted event on approve', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));
        const events: GovernanceEvent[] = [];
        mw.on('approval.granted', (e) => events.push(e));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await mw.resolveApproval(evalResult.approvalId!, {
          status: 'approved', approver: 'admin',
        });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(events).toHaveLength(1);
        expect(events[0].data.approver).toBe('admin');
      });

      it('should emit approval.rejected event on reject', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));
        const events: GovernanceEvent[] = [];
        mw.on('approval.rejected', (e) => events.push(e));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await mw.resolveApproval(evalResult.approvalId!, {
          status: 'rejected', approver: 'ciso',
        });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(events).toHaveLength(1);
      });

      it('should write audit event on resolve', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await mw.resolveApproval(evalResult.approvalId!, {
          status: 'approved', approver: 'admin',
        });

        expect(db.writeAuditEvent).toHaveBeenCalledTimes(1);
        const auditCall = (db.writeAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(auditCall.result).toBe('allowed');
        expect(auditCall.tool).toBe('dangerous_tool');
      });

      it('should write denied audit event on rejection', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await mw.resolveApproval(evalResult.approvalId!, {
          status: 'rejected', approver: 'ciso',
        });

        const auditCall = (db.writeAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(auditCall.result).toBe('denied');
      });

      it('should throw DATABASE_REQUIRED without DB', async () => {
        const mw = new GovernanceMiddleware(makeOptions());
        await expect(mw.resolveApproval('id', { status: 'approved' }))
          .rejects.toThrow(GovernanceError);
      });
    });

    describe('getApprovalRequest() — lazy timeout', () => {
      it('should return approval by id', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        const approval = await mw.getApprovalRequest(evalResult.approvalId!);

        expect(approval).not.toBeNull();
        expect(approval!.id).toBe(evalResult.approvalId);
        expect(approval!.status).toBe('pending');
      });

      it('should return null for nonexistent id', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({ db }));

        const approval = await mw.getApprovalRequest('nonexistent');
        expect(approval).toBeNull();
      });

      it('should auto-resolve expired pending approvals to timeout', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware({
          ...makeOptions({ db, policy: makeApprovalPolicy() }),
          approvalTimeoutSeconds: 0, // immediate timeout
        });

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });

        // Wait a tiny bit for deadline to pass
        await new Promise((resolve) => setTimeout(resolve, 10));

        const approval = await mw.getApprovalRequest(evalResult.approvalId!);
        expect(approval!.status).toBe('timeout');
      });

      it('should emit approval.timeout on lazy timeout', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware({
          ...makeOptions({ db, policy: makeApprovalPolicy() }),
          approvalTimeoutSeconds: 0,
        });
        const events: GovernanceEvent[] = [];
        mw.on('approval.timeout', (e) => events.push(e));

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await mw.getApprovalRequest(evalResult.approvalId!);

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(events).toHaveLength(1);
      });

      it('should write audit event with approval_timeout on lazy timeout (F-01)', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware({
          ...makeOptions({ db, policy: makeApprovalPolicy() }),
          approvalTimeoutSeconds: 0,
        });

        const evalResult = await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await mw.getApprovalRequest(evalResult.approvalId!);

        expect(db.writeAuditEvent).toHaveBeenCalledTimes(1);
        const auditCall = (db.writeAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(auditCall.result).toBe('denied');
        expect(auditCall.failureCategory).toBe('approval_timeout');
        expect(auditCall.reason).toContain('timed out');
      });

      it('should throw DATABASE_REQUIRED without DB', async () => {
        const mw = new GovernanceMiddleware(makeOptions());
        await expect(mw.getApprovalRequest('id'))
          .rejects.toThrow(GovernanceError);
      });
    });

    describe('listApprovalRequests()', () => {
      it('should list all approval requests', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware(makeOptions({
          db,
          policy: makeApprovalPolicy(),
        }));

        await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await mw.evaluate({ agentId: 'b', tool: 'dangerous_tool' });

        const results = await mw.listApprovalRequests();
        expect(results).toHaveLength(2);
      });

      it('should auto-resolve expired items on list', async () => {
        const db = makeMockDb();
        const mw = new GovernanceMiddleware({
          ...makeOptions({ db, policy: makeApprovalPolicy() }),
          approvalTimeoutSeconds: 0,
        });

        await mw.evaluate({ agentId: 'a', tool: 'dangerous_tool' });
        await new Promise((resolve) => setTimeout(resolve, 10));

        const results = await mw.listApprovalRequests();
        expect(results[0].status).toBe('timeout');
      });

      it('should throw DATABASE_REQUIRED without DB', async () => {
        const mw = new GovernanceMiddleware(makeOptions());
        await expect(mw.listApprovalRequests())
          .rejects.toThrow(GovernanceError);
      });
    });
  });

  describe('Audit trail integration', () => {
    it('should write audit event on evaluate — allowed', async () => {
      const db = makeMockDb();
      const mw = new GovernanceMiddleware(makeOptions({ db }));

      await mw.evaluate({ agentId: 'test-agent', tool: 'any_tool', params: { key: 'val' } });

      expect(db.writeAuditEvent).toHaveBeenCalledTimes(1);
      const call = (db.writeAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.agentId).toBe('test-agent');
      expect(call.tool).toBe('any_tool');
      expect(call.result).toBe('allowed');
      expect(call.traceId).toMatch(/^[a-f0-9]{32}$/);
      expect(call.params).toEqual({ key: 'val' });
      expect(call.failureCategory).toBeUndefined();
    });

    it('should write audit event on evaluate — denied with failureCategory', async () => {
      const db = makeMockDb();
      const policy = makePolicy({ rules: [{ tool: '*', effect: 'deny', reason: 'Locked' }] });
      const mw = new GovernanceMiddleware(makeOptions({ db, policy }));

      await mw.evaluate({ agentId: 'test-agent', tool: 'any_tool' });

      expect(db.writeAuditEvent).toHaveBeenCalledTimes(1);
      const call = (db.writeAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.result).toBe('denied');
      expect(call.reason).toBe('Locked');
      expect(call.failureCategory).toBe('policy_denial');
    });

    it('should return evaluate result unchanged when audit write fails', async () => {
      const db = makeMockDb();
      (db.writeAuditEvent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB write timeout'),
      );
      const mw = new GovernanceMiddleware(makeOptions({ db }));

      const result = await mw.evaluate({ agentId: 'test-agent', tool: 'any_tool' });

      expect(result.allowed).toBe(true);
      expect(result.traceId).toBeDefined();
      expect(db.writeAuditEvent).toHaveBeenCalledTimes(1);
    });

    it('should write audit event on kill-switch denial', async () => {
      const db = makeMockDb();
      const mw = new GovernanceMiddleware(makeOptions({ db }));
      mw.emergencyStop('Emergency');

      await mw.evaluate({ agentId: 'test-agent', tool: 'any_tool' });

      expect(db.writeAuditEvent).toHaveBeenCalledTimes(1);
      const call = (db.writeAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.result).toBe('denied');
      expect(call.reason).toContain('Kill-Switch');
      expect(call.agentId).toBe('test-agent');
      expect(call.tool).toBe('any_tool');
    });

    it('should return kill-switch denial unchanged when audit write fails', async () => {
      const db = makeMockDb();
      (db.writeAuditEvent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB connection lost'),
      );
      const mw = new GovernanceMiddleware(makeOptions({ db }));
      mw.emergencyStop('Emergency');

      const result = await mw.evaluate({ agentId: 'test-agent', tool: 'any_tool' });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Kill-Switch');
    });

    it('should not crash when evaluating without DB (no audit write)', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const result = await mw.evaluate({ agentId: 'a', tool: 'x' });

      expect(result.allowed).toBe(true);
    });

    it('should accept AgentConfig without allowedTools (default to empty array)', async () => {
      const db = makeMockDb();
      const mw = new GovernanceMiddleware(makeOptions({ db }));

      const id = await mw.registerAgent({ agentId: 'agent-no-tools', name: 'No Tools' } as AgentConfig);

      expect(id).toBe('agent-no-tools');
      const registeredConfig = (db.registerAgent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(registeredConfig.allowedTools).toEqual([]);
    });
  });

  describe('tenantId propagation', () => {
    it('should propagate tenantId in emitted events after forTenant()', async () => {
      const scopedDb = makeMockDb();
      const mockDb = makeMockDb();
      (mockDb as Record<string, unknown>).forTenant = vi.fn().mockReturnValue(scopedDb);

      const mw = new GovernanceMiddleware(makeOptions({ db: mockDb }));
      const scoped = mw.forTenant('tenant-abc');

      const events: GovernanceEvent[] = [];
      scoped.on('tool_call.allowed', (e) => { events.push(e); });

      await scoped.evaluate({ agentId: 'a', tool: 'allowed_tool', params: {} });

      // Wait for async event dispatch
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events).toHaveLength(1);
      expect(events[0].tenantId).toBe('tenant-abc');
    });

    it('should have undefined tenantId on root middleware events', async () => {
      const mw = new GovernanceMiddleware(makeOptions());

      const events: GovernanceEvent[] = [];
      mw.on('tool_call.allowed', (e) => { events.push(e); });

      await mw.evaluate({ agentId: 'a', tool: 'allowed_tool', params: {} });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events).toHaveLength(1);
      expect(events[0].tenantId).toBeUndefined();
    });

    it('should propagate tenantId in denied events', async () => {
      const scopedDb = makeMockDb();
      const mockDb = makeMockDb();
      (mockDb as Record<string, unknown>).forTenant = vi.fn().mockReturnValue(scopedDb);

      const mw = new GovernanceMiddleware(makeOptions({ db: mockDb, policy: makePolicy() }));
      const scoped = mw.forTenant('tenant-xyz');

      const events: GovernanceEvent[] = [];
      scoped.on('tool_call.denied', (e) => { events.push(e); });

      await scoped.evaluate({ agentId: 'a', tool: 'denied_tool', params: {} });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events).toHaveLength(1);
      expect(events[0].tenantId).toBe('tenant-xyz');
    });
  });

  describe('clearPolicy() (F-03)', () => {
    it('should clear inline policy and fall back to DB', async () => {
      const db = makeMockDb();
      const mw = new GovernanceMiddleware(makeOptions({
        db,
        policy: makePolicy({ rules: [{ tool: '*', effect: 'deny', reason: 'inline deny' }] }),
      }));

      // Inline policy denies
      const r1 = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(r1.allowed).toBe(false);
      expect(r1.reason).toBe('inline deny');

      // Clear inline policy
      mw.clearPolicy();

      // Now falls back to DB (which returns null → default allow-all)
      const r2 = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(r2.allowed).toBe(true);
    });

    it('should allow setPolicy after clearPolicy and apply the new policy', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      mw.setPolicy(makePolicy());
      mw.clearPolicy();
      mw.setPolicy(makePolicy({ rules: [{ tool: '*', effect: 'deny', reason: 'Re-locked' }] }));

      const result = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Re-locked');
    });

    it('should fall back to default allow-all after clearPolicy without DB', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      mw.setPolicy(makePolicy({ rules: [{ tool: '*', effect: 'deny', reason: 'Locked' }] }));

      const r1 = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(r1.allowed).toBe(false);

      mw.clearPolicy();

      const r2 = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(r2.allowed).toBe(true); // Default allow-all, no DB
    });
  });

  describe('audit.write_failure event (F-05)', () => {
    it('should emit audit.write_failure when writeAuditEvent throws (policy path)', async () => {
      const db = makeMockDb();
      (db.writeAuditEvent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB disk full'));

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      const events: GovernanceEvent[] = [];
      mw.on('audit.write_failure', (e) => events.push(e));

      // evaluate should still succeed (audit write is best-effort)
      const result = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(result.allowed).toBe(true);

      await new Promise((r) => setTimeout(r, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.error).toBe('Database write failed');
      expect(events[0].data.context).toBe('policy_evaluation');
      expect(events[0].agentId).toBe('a');
    });

    it('should emit audit.write_failure when writeAuditEvent throws (kill-switch path)', async () => {
      const db = makeMockDb();
      (db.writeAuditEvent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection lost'));

      const mw = new GovernanceMiddleware(makeOptions({ db }));
      mw.emergencyStop('test');

      const events: GovernanceEvent[] = [];
      mw.on('audit.write_failure', (e) => events.push(e));

      const result = await mw.evaluate({ agentId: 'a', tool: 'x' });
      expect(result.allowed).toBe(false);

      await new Promise((r) => setTimeout(r, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.error).toBe('Database write failed');
      expect(events[0].data.context).toBe('killswitch_denial');

      mw.resetKillSwitch();
    });
  });

  describe('killswitch.deactivated event (F-02)', () => {
    it('should emit killswitch.deactivated on reset with reason', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const events: GovernanceEvent[] = [];
      mw.on('killswitch.deactivated', (e) => events.push(e));

      mw.emergencyStop('Incident');
      mw.resetKillSwitch('All clear');

      await new Promise((r) => setTimeout(r, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toBe('All clear');
      expect(events[0].data.previousReason).toBe('Incident');
    });

    it('should emit killswitch.deactivated with default reason when none provided', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const events: GovernanceEvent[] = [];
      mw.on('killswitch.deactivated', (e) => events.push(e));

      mw.emergencyStop('Test');
      mw.resetKillSwitch();

      await new Promise((r) => setTimeout(r, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toBe('Manual reset');
    });

    it('should not emit killswitch.deactivated when not active', async () => {
      const mw = new GovernanceMiddleware(makeOptions());
      const events: GovernanceEvent[] = [];
      mw.on('killswitch.deactivated', (e) => events.push(e));

      mw.resetKillSwitch(); // Not active — should be no-op

      await new Promise((r) => setTimeout(r, 50));
      expect(events).toHaveLength(0);
    });
  });
});
