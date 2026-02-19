import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { ToolRegistry } from '@agentbouncr/core';
import type { GovernanceTool } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

function createTool(overrides: Partial<GovernanceTool> = {}): GovernanceTool {
  return {
    name: 'file_read',
    description: 'Read a file',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path' },
    ],
    riskLevel: 'low',
    source: 'manual',
    ...overrides,
  };
}

describe('ToolRegistry (Singleton → DI)', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(silentLogger);
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool = createTool();
      registry.register(tool);
      expect(registry.has('file_read')).toBe(true);
    });

    it('should overwrite existing tool with same name', () => {
      registry.register(createTool({ description: 'v1' }));
      registry.register(createTool({ description: 'v2' }));

      expect(registry.get('file_read')?.description).toBe('v2');
      expect(registry.count()).toBe(1);
    });
  });

  describe('get', () => {
    it('should return the registered tool', () => {
      const tool = createTool();
      registry.register(tool);
      expect(registry.get('file_read')).toEqual(tool);
    });

    it('should return undefined for unregistered tool', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for registered tool', () => {
      registry.register(createTool());
      expect(registry.has('file_read')).toBe(true);
    });

    it('should return false for unregistered tool', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all registered tools', () => {
      registry.register(createTool({ name: 'file_read' }));
      registry.register(createTool({ name: 'file_write', riskLevel: 'high' }));

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((t) => t.name)).toContain('file_read');
      expect(all.map((t) => t.name)).toContain('file_write');
    });

    it('should return empty array when no tools registered', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('getToolsForAgent', () => {
    it('should return only tools the agent is allowed to use', () => {
      registry.register(createTool({ name: 'file_read' }));
      registry.register(createTool({ name: 'file_write' }));
      registry.register(createTool({ name: 'approve_payment' }));

      const tools = registry.getToolsForAgent(['file_read', 'file_write']);

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['file_read', 'file_write']);
    });

    it('should skip tools not in registry', () => {
      registry.register(createTool({ name: 'file_read' }));

      const tools = registry.getToolsForAgent(['file_read', 'nonexistent']);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('file_read');
    });

    it('should return empty array for empty allowed list', () => {
      registry.register(createTool());
      expect(registry.getToolsForAgent([])).toEqual([]);
    });
  });

  describe('toProviderTools', () => {
    it('should convert to provider-agnostic format', () => {
      registry.register(createTool({
        name: 'file_read',
        description: 'Read a file',
        parameters: [
          { name: 'path', type: 'string', required: true, description: 'File path' },
        ],
      }));

      const providerTools = registry.toProviderTools(['file_read']);

      expect(providerTools).toHaveLength(1);
      expect(providerTools[0]).toEqual({
        name: 'file_read',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      });
    });

    it('should return empty description when not set', () => {
      registry.register(createTool({ name: 'ping', description: undefined }));
      const tools = registry.toProviderTools(['ping']);
      expect(tools[0].description).toBe('');
    });

    it('should only include tools from allowed list', () => {
      registry.register(createTool({ name: 'file_read' }));
      registry.register(createTool({ name: 'file_write' }));

      const tools = registry.toProviderTools(['file_read']);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('file_read');
    });
  });

  describe('count', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.count()).toBe(0);
    });

    it('should return correct count', () => {
      registry.register(createTool({ name: 'a' }));
      registry.register(createTool({ name: 'b' }));
      expect(registry.count()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all tools', () => {
      registry.register(createTool({ name: 'a' }));
      registry.register(createTool({ name: 'b' }));
      registry.clear();
      expect(registry.count()).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('DI verification', () => {
    it('should be instantiable without singleton — each instance is independent', () => {
      const registry1 = new ToolRegistry(silentLogger);
      const registry2 = new ToolRegistry(silentLogger);

      registry1.register(createTool({ name: 'tool_a' }));

      expect(registry1.has('tool_a')).toBe(true);
      expect(registry2.has('tool_a')).toBe(false);
    });
  });
});
