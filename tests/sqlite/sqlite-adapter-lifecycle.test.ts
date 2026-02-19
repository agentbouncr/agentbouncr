import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import pino from 'pino';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import { GovernanceError } from '@agentbouncr/core';
import type { AgentConfig } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });
const migrationsDir = join(process.cwd(), 'migrations');

function createAdapter(): SqliteDatabaseAdapter {
  return new SqliteDatabaseAdapter(silentLogger, ':memory:', migrationsDir);
}

const testAgent: AgentConfig = {
  agentId: 'test-agent',
  name: 'Test Agent',
  description: 'A test agent',
  allowedTools: ['file_read', 'search_web'],
  policyName: 'test-policy',
  metadata: { env: 'test' },
};

describe('SqliteDatabaseAdapter — Agent Lifecycle Extension', () => {
  let adapter: SqliteDatabaseAdapter;

  beforeEach(async () => {
    adapter = createAdapter();
    await adapter.runMigrations();
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('updateAgentStatus()', () => {
    it('should update agent status to running', async () => {
      await adapter.registerAgent(testAgent);
      await adapter.updateAgentStatus('test-agent', 'running');

      const status = await adapter.getAgentStatus('test-agent');
      expect(status).not.toBeNull();
      if (!status) return;
      expect(status.status).toBe('running');
    });

    it('should update agent status to stopped', async () => {
      await adapter.registerAgent(testAgent);
      await adapter.updateAgentStatus('test-agent', 'running');
      await adapter.updateAgentStatus('test-agent', 'stopped');

      const status = await adapter.getAgentStatus('test-agent');
      expect(status).not.toBeNull();
      if (!status) return;
      expect(status.status).toBe('stopped');
    });

    it('should update agent status to error', async () => {
      await adapter.registerAgent(testAgent);
      await adapter.updateAgentStatus('test-agent', 'error');

      const status = await adapter.getAgentStatus('test-agent');
      expect(status).not.toBeNull();
      if (!status) return;
      expect(status.status).toBe('error');
    });

    it('should update last_active_at on status change', async () => {
      await adapter.registerAgent(testAgent);

      const before = await adapter.getAgentStatus('test-agent');
      expect(before?.lastActiveAt).toBeUndefined();

      await adapter.updateAgentStatus('test-agent', 'running');

      const after = await adapter.getAgentStatus('test-agent');
      expect(after?.lastActiveAt).toBeDefined();
    });

    it('should throw GovernanceError with code AGENT_NOT_FOUND for unknown agent', async () => {
      try {
        await adapter.updateAgentStatus('nonexistent', 'running');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('AGENT_NOT_FOUND');
        expect((err as GovernanceError).category).toBe('config_error');
        expect((err as GovernanceError).message).toContain('not found');
      }
    });
  });

  describe('listAgents()', () => {
    it('should return empty array when no agents', async () => {
      const agents = await adapter.listAgents();
      expect(agents).toEqual([]);
    });

    it('should return all registered agents', async () => {
      await adapter.registerAgent(testAgent);
      await adapter.registerAgent({
        agentId: 'second-agent',
        name: 'Second Agent',
        allowedTools: ['tool_a'],
      });

      const agents = await adapter.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.agentId)).toContain('test-agent');
      expect(agents.map((a) => a.agentId)).toContain('second-agent');
    });

    it('should return agents ordered by registeredAt', async () => {
      await adapter.registerAgent(testAgent);
      await adapter.registerAgent({
        agentId: 'second-agent',
        name: 'Second',
        allowedTools: [],
      });

      const agents = await adapter.listAgents();
      expect(agents[0].agentId).toBe('test-agent');
      expect(agents[1].agentId).toBe('second-agent');
    });

    it('should reflect updated status', async () => {
      await adapter.registerAgent(testAgent);
      await adapter.updateAgentStatus('test-agent', 'running');

      const agents = await adapter.listAgents();
      expect(agents[0].status).toBe('running');
    });
  });

  describe('deleteAgent()', () => {
    it('should delete an existing agent and return true', async () => {
      await adapter.registerAgent(testAgent);
      const result = await adapter.deleteAgent('test-agent');

      expect(result).toBe(true);
      const status = await adapter.getAgentStatus('test-agent');
      expect(status).toBeNull();
    });

    it('should return false for nonexistent agent (idempotent)', async () => {
      const result = await adapter.deleteAgent('nonexistent');
      expect(result).toBe(false);
    });

    it('should only delete the specified agent', async () => {
      await adapter.registerAgent(testAgent);
      await adapter.registerAgent({
        agentId: 'other-agent',
        name: 'Other',
        allowedTools: [],
      });

      await adapter.deleteAgent('test-agent');

      const agents = await adapter.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('other-agent');
    });
  });
});
