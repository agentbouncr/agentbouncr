/**
 * Tests for Audit Search Enhancement — SQLite adapter.
 *
 * Covers: failureCategory filter, search LIKE on reason/params,
 * combined filters.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import pino from 'pino';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import type { AuditEventInput } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });
const migrationsDir = join(process.cwd(), 'migrations');

function createAdapter(): SqliteDatabaseAdapter {
  return new SqliteDatabaseAdapter(silentLogger, ':memory:', migrationsDir);
}

function makeEvent(overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    traceId: 'aaaa1111aaaa1111aaaa1111aaaa1111',
    timestamp: new Date().toISOString(),
    agentId: 'agent-1',
    tool: 'file_write',
    result: 'allowed',
    durationMs: 10,
    ...overrides,
  };
}

describe('SqliteDatabaseAdapter — Audit Search', () => {
  let adapter: SqliteDatabaseAdapter;

  beforeEach(async () => {
    adapter = createAdapter();
    await adapter.runMigrations();
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('failureCategory filter', () => {
    it('should filter by failureCategory', async () => {
      await adapter.writeAuditEvent(makeEvent({
        result: 'denied',
        failureCategory: 'policy_denial',
        reason: 'Not permitted',
      }));
      await adapter.writeAuditEvent(makeEvent({
        result: 'error',
        failureCategory: 'provider_timeout',
        reason: 'Timeout',
      }));
      await adapter.writeAuditEvent(makeEvent({
        result: 'allowed',
      }));

      const denied = await adapter.queryAuditEvents({ failureCategory: 'policy_denial' });
      expect(denied).toHaveLength(1);
      expect(denied[0].failureCategory).toBe('policy_denial');

      const timeout = await adapter.queryAuditEvents({ failureCategory: 'provider_timeout' });
      expect(timeout).toHaveLength(1);
      expect(timeout[0].failureCategory).toBe('provider_timeout');
    });

    it('should return empty when no events match failureCategory', async () => {
      await adapter.writeAuditEvent(makeEvent({
        result: 'denied',
        failureCategory: 'policy_denial',
      }));

      const result = await adapter.queryAuditEvents({ failureCategory: 'rate_limit' });
      expect(result).toHaveLength(0);
    });
  });

  describe('search filter', () => {
    it('should search in reason field', async () => {
      await adapter.writeAuditEvent(makeEvent({
        result: 'denied',
        reason: 'Writing to /etc/passwd is not permitted',
      }));
      await adapter.writeAuditEvent(makeEvent({
        result: 'denied',
        reason: 'Tool not found in registry',
      }));

      const result = await adapter.queryAuditEvents({ search: 'passwd' });
      expect(result).toHaveLength(1);
      expect(result[0].reason).toContain('passwd');
    });

    it('should search in params field (JSON)', async () => {
      await adapter.writeAuditEvent(makeEvent({
        params: { path: '/var/log/syslog', mode: 'read' },
      }));
      await adapter.writeAuditEvent(makeEvent({
        params: { path: '/tmp/output.txt' },
      }));

      const result = await adapter.queryAuditEvents({ search: 'syslog' });
      expect(result).toHaveLength(1);
      expect(result[0].params).toEqual({ path: '/var/log/syslog', mode: 'read' });
    });

    it('should be case-insensitive in reason (SQLite LIKE is case-insensitive for ASCII)', async () => {
      await adapter.writeAuditEvent(makeEvent({
        result: 'denied',
        reason: 'PERMISSION DENIED for agent',
      }));

      // SQLite LIKE is case-insensitive for ASCII characters
      const result = await adapter.queryAuditEvents({ search: 'permission' });
      expect(result).toHaveLength(1);
    });

    it('should handle search with SQL LIKE special characters', async () => {
      await adapter.writeAuditEvent(makeEvent({
        reason: 'Value is 100% complete',
      }));
      await adapter.writeAuditEvent(makeEvent({
        reason: 'Something else',
      }));

      // The % in "100%" should be escaped and not act as wildcard
      const result = await adapter.queryAuditEvents({ search: '100%' });
      expect(result).toHaveLength(1);
      expect(result[0].reason).toContain('100%');
    });

    it('should handle search with underscore characters', async () => {
      await adapter.writeAuditEvent(makeEvent({
        reason: 'file_write denied for agent',
      }));
      await adapter.writeAuditEvent(makeEvent({
        reason: 'filebwrite denied for agent',
      }));

      // _ should be escaped and not act as single-char wildcard
      const result = await adapter.queryAuditEvents({ search: 'file_write' });
      expect(result).toHaveLength(1);
      expect(result[0].reason).toContain('file_write');
    });

    it('should handle search containing the escape character (!)', async () => {
      await adapter.writeAuditEvent(makeEvent({
        reason: 'Alert! Critical failure detected',
      }));
      await adapter.writeAuditEvent(makeEvent({
        reason: 'Alert - Critical failure detected',
      }));

      const result = await adapter.queryAuditEvents({ search: 'Alert!' });
      expect(result).toHaveLength(1);
      expect(result[0].reason).toContain('Alert!');
    });

    it('should return empty when search matches nothing', async () => {
      await adapter.writeAuditEvent(makeEvent({ reason: 'allowed' }));

      const result = await adapter.queryAuditEvents({ search: 'nonexistent-term' });
      expect(result).toHaveLength(0);
    });
  });

  describe('combined filters', () => {
    it('should combine failureCategory with search', async () => {
      await adapter.writeAuditEvent(makeEvent({
        result: 'denied',
        failureCategory: 'policy_denial',
        reason: 'Writing to /etc/passwd blocked',
      }));
      await adapter.writeAuditEvent(makeEvent({
        result: 'denied',
        failureCategory: 'policy_denial',
        reason: 'Reading /var/log blocked',
      }));
      await adapter.writeAuditEvent(makeEvent({
        result: 'error',
        failureCategory: 'provider_timeout',
        reason: 'Provider timed out',
      }));

      const result = await adapter.queryAuditEvents({
        failureCategory: 'policy_denial',
        search: 'passwd',
      });
      expect(result).toHaveLength(1);
      expect(result[0].reason).toContain('passwd');
      expect(result[0].failureCategory).toBe('policy_denial');
    });

    it('should combine failureCategory with agentId and result', async () => {
      await adapter.writeAuditEvent(makeEvent({
        agentId: 'agent-a',
        result: 'denied',
        failureCategory: 'policy_denial',
      }));
      await adapter.writeAuditEvent(makeEvent({
        agentId: 'agent-b',
        result: 'denied',
        failureCategory: 'policy_denial',
      }));

      const result = await adapter.queryAuditEvents({
        agentId: 'agent-a',
        result: 'denied',
        failureCategory: 'policy_denial',
      });
      expect(result).toHaveLength(1);
      expect(result[0].agentId).toBe('agent-a');
    });

    it('should combine search with timestamp range', async () => {
      await adapter.writeAuditEvent(makeEvent({
        timestamp: '2026-01-10T10:00:00.000Z',
        reason: 'Operation blocked',
      }));
      await adapter.writeAuditEvent(makeEvent({
        timestamp: '2026-01-20T10:00:00.000Z',
        reason: 'Operation blocked',
      }));

      const result = await adapter.queryAuditEvents({
        search: 'blocked',
        fromTimestamp: '2026-01-15T00:00:00.000Z',
      });
      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe('2026-01-20T10:00:00.000Z');
    });

    it('should combine search with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.writeAuditEvent(makeEvent({
          reason: `Target operation ${i}`,
        }));
      }
      await adapter.writeAuditEvent(makeEvent({
        reason: 'Unrelated event',
      }));

      const page1 = await adapter.queryAuditEvents({ search: 'Target', limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await adapter.queryAuditEvents({ search: 'Target', limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = await adapter.queryAuditEvents({ search: 'Target', limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });
  });
});
