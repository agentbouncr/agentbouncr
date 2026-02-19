import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import pino from 'pino';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import type { GovernanceTool } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });
const migrationsDir = join(process.cwd(), 'migrations');

function createAdapter(): SqliteDatabaseAdapter {
  return new SqliteDatabaseAdapter(silentLogger, ':memory:', migrationsDir);
}

function makeTool(overrides?: Partial<GovernanceTool>): GovernanceTool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path' },
    ],
    riskLevel: 'medium',
    source: 'mcp',
    ...overrides,
  };
}

describe('SqliteDatabaseAdapter — Tool Registry', () => {
  let adapter: SqliteDatabaseAdapter;

  beforeEach(async () => {
    adapter = createAdapter();
    await adapter.runMigrations();
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('schema version', () => {
    it('should be at version 3 after migrations', async () => {
      const version = await adapter.getSchemaVersion();
      expect(version).toBe(3);
    });
  });

  describe('writeTool + getTool', () => {
    it('should store and retrieve a tool', async () => {
      const tool = makeTool({ name: 'file_read' });
      await adapter.writeTool(tool);

      const retrieved = await adapter.getTool('file_read');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('file_read');
      expect(retrieved!.description).toBe('A test tool');
      expect(retrieved!.riskLevel).toBe('medium');
      expect(retrieved!.source).toBe('mcp');
      expect(retrieved!.parameters).toHaveLength(1);
      expect(retrieved!.parameters[0].name).toBe('path');
      expect(retrieved!.parameters[0].type).toBe('string');
      expect(retrieved!.parameters[0].required).toBe(true);
    });

    it('should return null for non-existent tool', async () => {
      const result = await adapter.getTool('nonexistent');
      expect(result).toBeNull();
    });

    it('should upsert on conflict (same name)', async () => {
      await adapter.writeTool(makeTool({ name: 'x', riskLevel: 'low' }));
      await adapter.writeTool(makeTool({ name: 'x', riskLevel: 'critical' }));

      const retrieved = await adapter.getTool('x');
      expect(retrieved!.riskLevel).toBe('critical');
    });

    it('should store tags as JSON', async () => {
      await adapter.writeTool(makeTool({ name: 'tagged', tags: ['a', 'b'] }));
      const retrieved = await adapter.getTool('tagged');
      expect(retrieved!.tags).toEqual(['a', 'b']);
    });

    it('should handle optional fields', async () => {
      await adapter.writeTool({
        name: 'minimal',
        parameters: [],
        riskLevel: 'low',
        source: 'manual',
      });
      const retrieved = await adapter.getTool('minimal');
      expect(retrieved!.description).toBeUndefined();
      expect(retrieved!.category).toBeUndefined();
      expect(retrieved!.version).toBeUndefined();
      expect(retrieved!.tags).toBeUndefined();
      expect(retrieved!.timeout).toBeUndefined();
    });
  });

  describe('listTools', () => {
    beforeEach(async () => {
      await adapter.writeTool(makeTool({ name: 'delete_file', riskLevel: 'critical', source: 'mcp' }));
      await adapter.writeTool(makeTool({ name: 'read_file', riskLevel: 'low', source: 'mcp' }));
      await adapter.writeTool(makeTool({ name: 'create_user', riskLevel: 'medium', source: 'import', category: 'admin' }));
    });

    it('should return all tools without filter', async () => {
      const tools = await adapter.listTools();
      expect(tools).toHaveLength(3);
    });

    it('should filter by source', async () => {
      const tools = await adapter.listTools({ source: 'import' });
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('create_user');
    });

    it('should filter by riskLevel', async () => {
      const tools = await adapter.listTools({ riskLevel: 'critical' });
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('delete_file');
    });

    it('should filter by category', async () => {
      const tools = await adapter.listTools({ category: 'admin' });
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('create_user');
    });

    it('should filter by search (name)', async () => {
      const tools = await adapter.listTools({ search: 'file' });
      expect(tools).toHaveLength(2);
    });

    it('should combine filters', async () => {
      const tools = await adapter.listTools({ riskLevel: 'low', search: 'file' });
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('read_file');
    });

    it('should return empty array when no match', async () => {
      const tools = await adapter.listTools({ riskLevel: 'high' });
      expect(tools).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      await adapter.writeTool(makeTool({ name: 'delete_file', riskLevel: 'critical', source: 'mcp' }));
      await adapter.writeTool(makeTool({ name: 'read_file', riskLevel: 'low', source: 'mcp' }));
      await adapter.writeTool(makeTool({ name: 'create_user', riskLevel: 'medium', source: 'import', category: 'admin' }));
    });

    it('should handle tool names with SQL metacharacters safely', async () => {
      const evilName = "'; DROP TABLE tools; --";
      await adapter.writeTool(makeTool({ name: evilName }));
      const retrieved = await adapter.getTool(evilName);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe(evilName);
      // Verify table still exists
      const all = await adapter.listTools();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });

    it('should treat LIKE wildcards in search as literals', async () => {
      // "%" should not match everything — it's a literal search for "%"
      const tools = await adapter.listTools({ search: '%' });
      expect(tools).toHaveLength(0);
    });

    it('should treat "_" in search as literal', async () => {
      // "_" is a LIKE wildcard for single char — should be escaped
      const tools = await adapter.listTools({ search: '____' });
      expect(tools).toHaveLength(0);
    });

    it('should round-trip nested parameters with children and constraints', async () => {
      const tool = makeTool({
        name: 'complex_tool',
        parameters: [{
          name: 'config',
          type: 'object',
          required: true,
          children: [
            { name: 'mode', type: 'string', required: true, constraints: { enum: ['fast', 'slow'] } },
            { name: 'retries', type: 'number', required: false, constraints: { min: 0, max: 10 } },
          ],
        }],
      });
      await adapter.writeTool(tool);
      const retrieved = await adapter.getTool('complex_tool');
      expect(retrieved!.parameters[0].children).toHaveLength(2);
      expect(retrieved!.parameters[0].children![0].constraints!.enum).toEqual(['fast', 'slow']);
      expect(retrieved!.parameters[0].children![1].constraints!.max).toBe(10);
    });
  });

  describe('deleteTool', () => {
    it('should delete an existing tool and return true', async () => {
      await adapter.writeTool(makeTool({ name: 'to_delete' }));
      const result = await adapter.deleteTool('to_delete');
      expect(result).toBe(true);

      const retrieved = await adapter.getTool('to_delete');
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent tool', async () => {
      const result = await adapter.deleteTool('nonexistent');
      expect(result).toBe(false);
    });
  });
});
