import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { PermissionLayer, ToolRegistry } from '@agentbouncr/core';
import type { GovernanceTool } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

function createTool(name: string): GovernanceTool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [],
    riskLevel: 'low',
    source: 'manual',
  };
}

describe('PermissionLayer (Singleton → DI)', () => {
  let registry: ToolRegistry;
  let permissionLayer: PermissionLayer;

  beforeEach(() => {
    registry = new ToolRegistry(silentLogger);
    permissionLayer = new PermissionLayer(registry, silentLogger);

    registry.register(createTool('file_read'));
    registry.register(createTool('file_write'));
    registry.register(createTool('approve_payment'));
  });

  describe('checkPermission', () => {
    it('should allow when tool exists and agent has permission', () => {
      const result = permissionLayer.checkPermission(
        'claims-agent',
        'file_read',
        ['file_read', 'file_write'],
      );

      expect(result.allowed).toBe(true);
      expect(result.toolName).toBe('file_read');
      expect(result.agentId).toBe('claims-agent');
      expect(result.reason).toBeUndefined();
    });

    it('should deny when tool is not registered', () => {
      const result = permissionLayer.checkPermission(
        'claims-agent',
        'nonexistent_tool',
        ['nonexistent_tool'],
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not registered');
      expect(result.toolName).toBe('nonexistent_tool');
    });

    it('should deny when agent does not have permission for tool', () => {
      const result = permissionLayer.checkPermission(
        'claims-agent',
        'approve_payment',
        ['file_read', 'file_write'],
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not permitted');
      expect(result.agentId).toBe('claims-agent');
    });

    it('should deny when agent tools list is empty', () => {
      const result = permissionLayer.checkPermission(
        'claims-agent',
        'file_read',
        [],
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not permitted');
    });

    it('should check tool existence before permission (order matters)', () => {
      // Tool doesn't exist — should get "not registered" message, not "not permitted"
      const result = permissionLayer.checkPermission(
        'claims-agent',
        'ghost_tool',
        [],
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not registered');
    });
  });

  describe('deterministic behavior', () => {
    it('should return same result for same input — no LLM involved', () => {
      const input = ['claims-agent', 'file_read', ['file_read']] as const;

      const result1 = permissionLayer.checkPermission(...input);
      const result2 = permissionLayer.checkPermission(...input);

      expect(result1).toEqual(result2);
    });
  });

  describe('DI verification', () => {
    it('should be instantiable without singleton — each instance is independent', () => {
      const registry1 = new ToolRegistry(silentLogger);
      const registry2 = new ToolRegistry(silentLogger);

      registry1.register(createTool('tool_a'));
      registry2.register(createTool('tool_b'));

      const pl1 = new PermissionLayer(registry1, silentLogger);
      const pl2 = new PermissionLayer(registry2, silentLogger);

      expect(pl1.checkPermission('agent', 'tool_a', ['tool_a']).allowed).toBe(true);
      expect(pl1.checkPermission('agent', 'tool_b', ['tool_b']).allowed).toBe(false);

      expect(pl2.checkPermission('agent', 'tool_b', ['tool_b']).allowed).toBe(true);
      expect(pl2.checkPermission('agent', 'tool_a', ['tool_a']).allowed).toBe(false);
    });
  });

  describe('fail-secure', () => {
    it('should deny when registry throws an error (not pass-through)', () => {
      const brokenRegistry = {
        has: () => { throw new Error('DB connection lost'); },
        get: () => undefined,
        getAll: () => [],
        count: () => 0,
      } as unknown as ToolRegistry;

      const pl = new PermissionLayer(brokenRegistry, silentLogger);
      const result = pl.checkPermission('agent', 'tool', ['tool']);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Permission check failed');
    });
  });

  describe('multiple agents', () => {
    it('should enforce separate permissions per agent', () => {
      const reader = permissionLayer.checkPermission(
        'reader-agent',
        'file_read',
        ['file_read'],
      );

      const writer = permissionLayer.checkPermission(
        'writer-agent',
        'file_write',
        ['file_write'],
      );

      const readerWrite = permissionLayer.checkPermission(
        'reader-agent',
        'file_write',
        ['file_read'],
      );

      expect(reader.allowed).toBe(true);
      expect(writer.allowed).toBe(true);
      expect(readerWrite.allowed).toBe(false);
    });
  });
});
