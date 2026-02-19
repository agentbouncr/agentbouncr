import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import { join } from 'node:path';
import pino from 'pino';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import type { AuditEventInput, Policy, AgentConfig } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });
const migrationsDir = join(process.cwd(), 'migrations');

function createAdapter(): SqliteDatabaseAdapter {
  return new SqliteDatabaseAdapter(silentLogger, ':memory:', migrationsDir);
}

function makeAuditEvent(overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    timestamp: '2026-01-15T10:30:00.000Z',
    agentId: 'claims-agent',
    tool: 'file_read',
    result: 'allowed',
    durationMs: 42,
    ...overrides,
  };
}

describe('SqliteDatabaseAdapter', () => {
  let adapter: SqliteDatabaseAdapter;

  beforeEach(async () => {
    adapter = createAdapter();
    await adapter.runMigrations();
  });

  afterEach(async () => {
    await adapter.close();
  });

  // --- Schema Management ---

  describe('runMigrations()', () => {
    it('should create tables without error', async () => {
      // Already called in beforeEach — verify schema version
      const version = await adapter.getSchemaVersion();
      expect(version).toBe(3);
    });

    it('should be idempotent (running twice is safe)', async () => {
      await adapter.runMigrations();
      const version = await adapter.getSchemaVersion();
      expect(version).toBe(3);
    });
  });

  describe('getSchemaVersion()', () => {
    it('should return 0 before migrations', async () => {
      const fresh = new SqliteDatabaseAdapter(silentLogger, ':memory:', migrationsDir);
      const version = await fresh.getSchemaVersion();
      expect(version).toBe(0);
      await fresh.close();
    });

    it('should return 3 after all migrations', async () => {
      const version = await adapter.getSchemaVersion();
      expect(version).toBe(3);
    });
  });

  // --- Audit Trail ---

  describe('writeAuditEvent()', () => {
    it('should write and read back an audit event', async () => {
      const event = makeAuditEvent();
      await adapter.writeAuditEvent(event);

      const events = await adapter.queryAuditEvents({});
      expect(events).toHaveLength(1);
      expect(events[0].traceId).toBe(event.traceId);
      expect(events[0].agentId).toBe(event.agentId);
      expect(events[0].tool).toBe(event.tool);
      expect(events[0].result).toBe(event.result);
      expect(events[0].durationMs).toBe(event.durationMs);
    });

    it('should auto-compute hash and previousHash', async () => {
      await adapter.writeAuditEvent(makeAuditEvent());

      const events = await adapter.queryAuditEvents({});
      expect(events[0].hash).toMatch(/^[a-f0-9]{64}$/);
      expect(events[0].previousHash).toBeNull();
    });

    it('should chain hashes across multiple events', async () => {
      await adapter.writeAuditEvent(makeAuditEvent());
      await adapter.writeAuditEvent(makeAuditEvent({
        timestamp: '2026-01-15T10:31:00.000Z',
        tool: 'file_write',
      }));

      const events = await adapter.queryAuditEvents({});
      expect(events).toHaveLength(2);
      expect(events[0].previousHash).toBeNull();
      expect(events[1].previousHash).toBe(events[0].hash);
    });

    it('should store and retrieve params as JSON', async () => {
      await adapter.writeAuditEvent(makeAuditEvent({
        params: { path: '/etc/config', mode: 'read' },
      }));

      const events = await adapter.queryAuditEvents({});
      expect(events[0].params).toEqual({ path: '/etc/config', mode: 'read' });
    });

    it('should store reason and failureCategory', async () => {
      await adapter.writeAuditEvent(makeAuditEvent({
        result: 'denied',
        reason: 'Policy violation',
        failureCategory: 'policy_denial',
      }));

      const events = await adapter.queryAuditEvents({});
      expect(events[0].reason).toBe('Policy violation');
      expect(events[0].failureCategory).toBe('policy_denial');
    });
  });

  describe('queryAuditEvents()', () => {
    beforeEach(async () => {
      await adapter.writeAuditEvent(makeAuditEvent({
        agentId: 'agent-a',
        tool: 'file_read',
        result: 'allowed',
        timestamp: '2026-01-15T10:00:00.000Z',
      }));
      await adapter.writeAuditEvent(makeAuditEvent({
        agentId: 'agent-b',
        tool: 'file_write',
        result: 'denied',
        timestamp: '2026-01-15T11:00:00.000Z',
      }));
      await adapter.writeAuditEvent(makeAuditEvent({
        agentId: 'agent-a',
        tool: 'search_web',
        result: 'allowed',
        timestamp: '2026-01-15T12:00:00.000Z',
      }));
    });

    it('should filter by agentId', async () => {
      const events = await adapter.queryAuditEvents({ agentId: 'agent-a' });
      expect(events).toHaveLength(2);
      events.forEach((e) => expect(e.agentId).toBe('agent-a'));
    });

    it('should filter by tool', async () => {
      const events = await adapter.queryAuditEvents({ tool: 'file_write' });
      expect(events).toHaveLength(1);
      expect(events[0].tool).toBe('file_write');
    });

    it('should filter by result', async () => {
      const events = await adapter.queryAuditEvents({ result: 'denied' });
      expect(events).toHaveLength(1);
      expect(events[0].result).toBe('denied');
    });

    it('should filter by traceId', async () => {
      // Add event with different traceId
      await adapter.writeAuditEvent(makeAuditEvent({
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
        timestamp: '2026-01-15T13:00:00.000Z',
      }));

      const events = await adapter.queryAuditEvents({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      });
      expect(events).toHaveLength(3);

      const otherEvents = await adapter.queryAuditEvents({
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      });
      expect(otherEvents).toHaveLength(1);
    });

    it('should support combined filters', async () => {
      const events = await adapter.queryAuditEvents({
        agentId: 'agent-a',
        result: 'allowed',
      });
      expect(events).toHaveLength(2);
      events.forEach((e) => {
        expect(e.agentId).toBe('agent-a');
        expect(e.result).toBe('allowed');
      });
    });

    it('should filter by timestamp range', async () => {
      const events = await adapter.queryAuditEvents({
        fromTimestamp: '2026-01-15T10:30:00.000Z',
        toTimestamp: '2026-01-15T11:30:00.000Z',
      });
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('agent-b');
    });

    it('should support limit', async () => {
      const events = await adapter.queryAuditEvents({ limit: 2 });
      expect(events).toHaveLength(2);
    });

    it('should support offset', async () => {
      const events = await adapter.queryAuditEvents({ limit: 1, offset: 1 });
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('agent-b');
    });

    it('should return empty array for no matches', async () => {
      const events = await adapter.queryAuditEvents({ agentId: 'nonexistent' });
      expect(events).toHaveLength(0);
    });
  });

  describe('getLatestAuditHash()', () => {
    it('should return null for empty table', async () => {
      const hash = await adapter.getLatestAuditHash();
      expect(hash).toBeNull();
    });

    it('should return hash of latest event', async () => {
      await adapter.writeAuditEvent(makeAuditEvent());
      const hash = await adapter.getLatestAuditHash();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyAuditChain()', () => {
    it('should return valid for empty chain', async () => {
      const result = await adapter.verifyAuditChain();
      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(0);
      expect(result.verifiedEvents).toBe(0);
    });

    it('should return valid for intact chain', async () => {
      await adapter.writeAuditEvent(makeAuditEvent());
      await adapter.writeAuditEvent(makeAuditEvent({
        timestamp: '2026-01-15T10:31:00.000Z',
      }));
      await adapter.writeAuditEvent(makeAuditEvent({
        timestamp: '2026-01-15T10:32:00.000Z',
      }));

      const result = await adapter.verifyAuditChain();
      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(3);
      expect(result.verifiedEvents).toBe(3);
    });

    it('should detect tampered hash (brokenAt = first event)', async () => {
      // Create a fresh adapter with manual schema (no append-only triggers)
      const tampered = createAdapter();
      tampered['db'].exec(`
        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT);
        INSERT INTO schema_version (version) VALUES (1);
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trace_id TEXT NOT NULL, timestamp TEXT NOT NULL,
          agent_id TEXT NOT NULL, tool TEXT NOT NULL, params TEXT,
          result TEXT NOT NULL, reason TEXT, duration_ms INTEGER NOT NULL,
          failure_category TEXT, previous_hash TEXT, hash TEXT NOT NULL
        );
        INSERT INTO audit_events (trace_id, timestamp, agent_id, tool, result, duration_ms, previous_hash, hash)
        VALUES ('abc', '2026-01-01T00:00:00Z', 'a', 't', 'allowed', 1, NULL, 'TAMPERED_HASH');
      `);

      const result = await tampered.verifyAuditChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
      expect(result.totalEvents).toBe(1);
      expect(result.verifiedEvents).toBe(0);
      await tampered.close();
    });

    it('should detect broken chain link (wrong previousHash)', async () => {
      const tampered = createAdapter();
      tampered['db'].exec(`
        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT);
        INSERT INTO schema_version (version) VALUES (1);
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trace_id TEXT NOT NULL, timestamp TEXT NOT NULL,
          agent_id TEXT NOT NULL, tool TEXT NOT NULL, params TEXT,
          result TEXT NOT NULL, reason TEXT, duration_ms INTEGER NOT NULL,
          failure_category TEXT, previous_hash TEXT, hash TEXT NOT NULL
        );
      `);

      // Insert first event with correct hash
      const { computeAuditHash } = await import('@agentbouncr/core');
      const hash1 = computeAuditHash({
        traceId: 'abc', timestamp: '2026-01-01T00:00:00Z',
        agentId: 'a', tool: 't', result: 'allowed', durationMs: 1, previousHash: null,
      });
      tampered['db'].prepare(
        'INSERT INTO audit_events (trace_id, timestamp, agent_id, tool, result, duration_ms, previous_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('abc', '2026-01-01T00:00:00Z', 'a', 't', 'allowed', 1, null, hash1);

      // Insert second event with WRONG previousHash (not matching hash1)
      const wrongPrevHash = 'wrong_hash_value';
      const hash2 = computeAuditHash({
        traceId: 'abc', timestamp: '2026-01-01T00:01:00Z',
        agentId: 'a', tool: 't', result: 'allowed', durationMs: 1, previousHash: wrongPrevHash,
      });
      tampered['db'].prepare(
        'INSERT INTO audit_events (trace_id, timestamp, agent_id, tool, result, duration_ms, previous_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('abc', '2026-01-01T00:01:00Z', 'a', 't', 'allowed', 1, wrongPrevHash, hash2);

      const result = await tampered.verifyAuditChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(2); // Second event has wrong link
      await tampered.close();
    });
  });

  describe('Append-Only enforcement', () => {
    it('should reject UPDATE on audit_events', async () => {
      await adapter.writeAuditEvent(makeAuditEvent());

      expect(() => {
        adapter['db'].prepare(
          'UPDATE audit_events SET result = ? WHERE id = 1',
        ).run('denied');
      }).toThrow(/append-only/i);
    });

    it('should reject DELETE on audit_events', async () => {
      await adapter.writeAuditEvent(makeAuditEvent());

      expect(() => {
        adapter['db'].prepare('DELETE FROM audit_events WHERE id = 1').run();
      }).toThrow(/append-only/i);
    });
  });

  describe('exportAuditEvents()', () => {
    it('should write JSON-Lines to stream', async () => {
      await adapter.writeAuditEvent(makeAuditEvent());
      await adapter.writeAuditEvent(makeAuditEvent({
        timestamp: '2026-01-15T10:31:00.000Z',
      }));

      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      });

      await adapter.exportAuditEvents({}, stream);

      // Wait for stream to finish
      await new Promise<void>((resolve) => stream.on('finish', resolve));

      const output = chunks.join('');
      const lines = output.trim().split('\n');
      expect(lines).toHaveLength(2);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(parsed.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should respect filter when exporting', async () => {
      await adapter.writeAuditEvent(makeAuditEvent({ agentId: 'agent-x' }));
      await adapter.writeAuditEvent(makeAuditEvent({
        agentId: 'agent-y',
        timestamp: '2026-01-15T10:31:00.000Z',
      }));

      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      });

      await adapter.exportAuditEvents({ agentId: 'agent-x' }, stream);
      await new Promise<void>((resolve) => stream.on('finish', resolve));

      const lines = chunks.join('').trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).agentId).toBe('agent-x');
    });
  });

  // --- Policy ---

  describe('writePolicy() / getActivePolicy()', () => {
    const testPolicy: Policy = {
      name: 'restrict-filesystem',
      version: '1.0',
      agentId: 'claims-agent',
      rules: [
        { tool: 'file_write', effect: 'deny', reason: 'No writes allowed' },
      ],
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:00:00.000Z',
    };

    it('should write and read back a policy', async () => {
      await adapter.writePolicy(testPolicy);
      const policy = await adapter.getActivePolicy('claims-agent');

      expect(policy).not.toBeNull();
      if (!policy) return;
      expect(policy.name).toBe('restrict-filesystem');
      expect(policy.version).toBe('1.0');
      expect(policy.rules).toHaveLength(1);
      expect(policy.rules[0].effect).toBe('deny');
    });

    it('should return null for unknown agent', async () => {
      const policy = await adapter.getActivePolicy('nonexistent');
      expect(policy).toBeNull();
    });

    it('should return global policy when no agent-specific exists', async () => {
      const globalPolicy: Policy = {
        ...testPolicy,
        name: 'global-policy',
        agentId: undefined,
      };
      await adapter.writePolicy(globalPolicy);

      const policy = await adapter.getActivePolicy('any-agent');
      expect(policy).not.toBeNull();
      if (!policy) return;
      expect(policy.name).toBe('global-policy');
    });

    it('should upsert policy on name conflict', async () => {
      await adapter.writePolicy(testPolicy);
      const updated: Policy = {
        ...testPolicy,
        version: '2.0',
        updatedAt: '2026-01-16T10:00:00.000Z',
      };
      await adapter.writePolicy(updated);

      const policy = await adapter.getActivePolicy('claims-agent');
      expect(policy).not.toBeNull();
      if (!policy) return;
      expect(policy.version).toBe('2.0');
    });

    it('should prefer agent-specific over global policy', async () => {
      const globalPolicy: Policy = {
        ...testPolicy,
        name: 'global-policy',
        agentId: undefined,
      };
      await adapter.writePolicy(globalPolicy);
      await adapter.writePolicy(testPolicy);

      const policy = await adapter.getActivePolicy('claims-agent');
      expect(policy).not.toBeNull();
      if (!policy) return;
      expect(policy.name).toBe('restrict-filesystem');
    });
  });

  describe('listPolicies()', () => {
    it('should return empty array when no policies exist', async () => {
      const policies = await adapter.listPolicies();
      expect(policies).toEqual([]);
    });

    it('should return all policies ordered by updated_at DESC', async () => {
      await adapter.writePolicy({
        name: 'policy-a',
        version: '1.0',
        rules: [{ tool: '*', effect: 'allow' }],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      await adapter.writePolicy({
        name: 'policy-b',
        version: '1.0',
        rules: [{ tool: '*', effect: 'deny' }],
        createdAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      });

      const policies = await adapter.listPolicies();
      expect(policies).toHaveLength(2);
      expect(policies[0].name).toBe('policy-b');
      expect(policies[1].name).toBe('policy-a');
    });
  });

  describe('getPolicyByName()', () => {
    it('should return null for non-existent policy', async () => {
      const policy = await adapter.getPolicyByName('nonexistent');
      expect(policy).toBeNull();
    });

    it('should return policy by name', async () => {
      await adapter.writePolicy({
        name: 'my-policy',
        version: '2.0',
        rules: [{ tool: 'file_read', effect: 'allow' }],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const policy = await adapter.getPolicyByName('my-policy');
      expect(policy).not.toBeNull();
      if (!policy) return;
      expect(policy.name).toBe('my-policy');
      expect(policy.version).toBe('2.0');
      expect(policy.rules).toHaveLength(1);
    });
  });

  describe('deletePolicy()', () => {
    it('should return false for non-existent policy', async () => {
      const result = await adapter.deletePolicy('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete existing policy and return true', async () => {
      await adapter.writePolicy({
        name: 'to-delete',
        version: '1.0',
        rules: [{ tool: '*', effect: 'allow' }],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const result = await adapter.deletePolicy('to-delete');
      expect(result).toBe(true);

      const policy = await adapter.getPolicyByName('to-delete');
      expect(policy).toBeNull();
    });
  });

  // --- Agent Lifecycle ---

  describe('registerAgent() / getAgentStatus()', () => {
    const testAgent: AgentConfig = {
      agentId: 'claims-agent',
      name: 'Claims Agent',
      description: 'Processes insurance claims',
      allowedTools: ['file_read', 'search_web'],
      policyName: 'restrict-filesystem',
      metadata: { version: '2.0' },
    };

    it('should register and retrieve agent', async () => {
      const id = await adapter.registerAgent(testAgent);
      expect(id).toBe('claims-agent');

      const status = await adapter.getAgentStatus('claims-agent');
      expect(status).not.toBeNull();
      if (!status) return;
      expect(status.agentId).toBe('claims-agent');
      expect(status.name).toBe('Claims Agent');
      expect(status.status).toBe('registered');
      expect(status.registeredAt).toBeDefined();
    });

    it('should return null for unknown agent', async () => {
      const status = await adapter.getAgentStatus('nonexistent');
      expect(status).toBeNull();
    });

    it('should upsert agent (INSERT OR REPLACE)', async () => {
      await adapter.registerAgent(testAgent);
      const updated: AgentConfig = {
        ...testAgent,
        name: 'Updated Claims Agent',
        description: 'Updated description',
      };
      await adapter.registerAgent(updated);

      const status = await adapter.getAgentStatus('claims-agent');
      expect(status).not.toBeNull();
      if (!status) return;
      expect(status.name).toBe('Updated Claims Agent');
    });
  });

  // --- Transaction ---

  describe('transaction()', () => {
    it('should execute operations atomically', async () => {
      await adapter.transaction(async (tx) => {
        tx.run(
          "INSERT INTO agents (agent_id, name, allowed_tools, status) VALUES (?, ?, ?, 'registered')",
          ['tx-agent', 'TX Agent', '[]'],
        );
      });

      const status = await adapter.getAgentStatus('tx-agent');
      expect(status).not.toBeNull();
      if (!status) return;
      expect(status.name).toBe('TX Agent');
    });

    it('should support tx.get()', async () => {
      await adapter.registerAgent({
        agentId: 'test-agent',
        name: 'Test',
        allowedTools: [],
      });

      const row = await adapter.transaction(async (tx) => {
        return tx.get<{ name: string }>('SELECT name FROM agents WHERE agent_id = ?', ['test-agent']);
      });
      expect(row).toBeDefined();
      if (!row) return;
      expect(row.name).toBe('Test');
    });

    it('should support tx.all()', async () => {
      await adapter.registerAgent({ agentId: 'a1', name: 'A1', allowedTools: [] });
      await adapter.registerAgent({ agentId: 'a2', name: 'A2', allowedTools: [] });

      const rows = await adapter.transaction(async (tx) => {
        return tx.all<{ agent_id: string }>('SELECT agent_id FROM agents ORDER BY agent_id');
      });
      expect(rows).toHaveLength(2);
    });

    it('should rollback on error (atomicity)', async () => {
      await expect(adapter.transaction(async (tx) => {
        tx.run(
          "INSERT INTO agents (agent_id, name, allowed_tools, status) VALUES (?, ?, ?, 'registered')",
          ['rollback-agent', 'Should Not Persist', '[]'],
        );
        throw new Error('Intentional failure');
      })).rejects.toThrow('Intentional failure');

      // Agent should NOT exist because transaction was rolled back
      const status = await adapter.getAgentStatus('rollback-agent');
      expect(status).toBeNull();
    });
  });

  // --- Lifecycle ---

  describe('close()', () => {
    it('should not throw on close', async () => {
      await expect(adapter.close()).resolves.not.toThrow();
    });

    it('should not throw on double close', async () => {
      await adapter.close();
      await expect(adapter.close()).resolves.not.toThrow();
    });
  });
});
