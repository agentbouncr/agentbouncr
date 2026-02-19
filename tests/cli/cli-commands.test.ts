import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import { GovernanceMiddleware, importMCPTools } from '@agentbouncr/core';
import type { AgentConfig } from '@agentbouncr/core';

/**
 * CLI tests verify the command logic through direct function calls
 * (not spawning processes). This tests the same code paths the CLI uses.
 */

const silentLogger = pino({ level: 'silent' });
const migrationsDir = join(process.cwd(), 'migrations');
const tmpDir = join(process.cwd(), 'tests', 'cli', 'tmp');

function createAdapter(): SqliteDatabaseAdapter {
  return new SqliteDatabaseAdapter(silentLogger, ':memory:', migrationsDir);
}

describe('CLI Commands (functional)', () => {
  let adapter: SqliteDatabaseAdapter;
  let mw: GovernanceMiddleware;

  beforeEach(async () => {
    adapter = createAdapter();
    await adapter.runMigrations();
    mw = new GovernanceMiddleware({ db: adapter, logger: silentLogger });

    // Create tmp dir for test files
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await adapter.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('agent create', () => {
    it('should register agent from JSON config', async () => {
      const config: AgentConfig = {
        agentId: 'test-agent',
        name: 'Test Agent',
        allowedTools: ['file_read'],
      };
      const configPath = join(tmpDir, 'agent.json');
      writeFileSync(configPath, JSON.stringify(config));

      // Simulate what CLI does: read file, parse JSON, register
      const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as AgentConfig;
      const id = await mw.registerAgent(raw);

      expect(id).toBe('test-agent');
      const status = await mw.getAgentStatus('test-agent');
      expect(status).not.toBeNull();
      if (!status) return;
      expect(status.name).toBe('Test Agent');
      expect(status.status).toBe('registered');
    });
  });

  describe('agent start / stop', () => {
    it('should start and stop agent', async () => {
      await mw.registerAgent({
        agentId: 'lifecycle-agent',
        name: 'Lifecycle',
        allowedTools: [],
      });

      await mw.startAgent('lifecycle-agent');
      let status = await mw.getAgentStatus('lifecycle-agent');
      expect(status?.status).toBe('running');

      await mw.stopAgent('lifecycle-agent');
      status = await mw.getAgentStatus('lifecycle-agent');
      expect(status?.status).toBe('stopped');
    });
  });

  describe('agent list', () => {
    it('should list registered agents', async () => {
      await mw.registerAgent({ agentId: 'a1', name: 'Agent 1', allowedTools: [] });
      await mw.registerAgent({ agentId: 'a2', name: 'Agent 2', allowedTools: [] });

      const agents = await mw.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.agentId)).toEqual(['a1', 'a2']);
    });

    it('should return empty list when no agents', async () => {
      const agents = await mw.listAgents();
      expect(agents).toEqual([]);
    });
  });

  describe('audit verify', () => {
    it('should verify empty audit trail', async () => {
      const result = await adapter.verifyAuditChain();
      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(0);
    });
  });

  describe('import --mcp', () => {
    it('should import tools from MCP manifest file', () => {
      const manifest = [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          inputSchema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
        {
          name: 'search_web',
          description: 'Search the web',
        },
      ];
      const manifestPath = join(tmpDir, 'mcp-manifest.json');
      writeFileSync(manifestPath, JSON.stringify(manifest));

      const raw = JSON.parse(
        readFileSync(manifestPath, 'utf-8'),
      ) as Parameters<typeof importMCPTools>[0];
      const tools = importMCPTools(raw);

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('get_weather');
      expect(tools[0].source).toBe('mcp');
      expect(tools[0].parameters).toHaveLength(1);
      expect(tools[1].name).toBe('search_web');
    });

    it('should handle manifest with tools wrapper object', () => {
      const manifest = {
        tools: [{ name: 'tool_a' }, { name: 'tool_b' }],
      };
      const manifestPath = join(tmpDir, 'mcp-wrapped.json');
      writeFileSync(manifestPath, JSON.stringify(manifest));

      const raw = JSON.parse(
        readFileSync(manifestPath, 'utf-8'),
      ) as { tools: Parameters<typeof importMCPTools>[0] };

      const toolList = Array.isArray(raw) ? raw : raw.tools;
      const tools = importMCPTools(toolList);

      expect(tools).toHaveLength(2);
    });
  });

  describe('stop --all', () => {
    it('should stop all running agents', async () => {
      await mw.registerAgent({ agentId: 'r1', name: 'Running 1', allowedTools: [] });
      await mw.registerAgent({ agentId: 'r2', name: 'Running 2', allowedTools: [] });
      await mw.registerAgent({ agentId: 's1', name: 'Already Stopped', allowedTools: [] });

      await mw.startAgent('r1');
      await mw.startAgent('r2');
      await mw.stopAgent('s1');

      // Simulate stop --all: stop all running/registered agents
      const agents = await mw.listAgents();
      let stopped = 0;
      for (const agent of agents) {
        if (agent.status === 'running' || agent.status === 'registered') {
          await mw.stopAgent(agent.agentId, 'Emergency stop via CLI');
          stopped++;
        }
      }

      expect(stopped).toBe(2); // r1 and r2

      const allAgents = await mw.listAgents();
      expect(allAgents.every((a) => a.status === 'stopped')).toBe(true);
    });
  });
});
