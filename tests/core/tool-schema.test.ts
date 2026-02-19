import { describe, it, expect } from 'vitest';
import {
  governanceToolSchema,
  governanceToolParameterSchema,
  riskLevelSchema,
  toolSourceSchema,
  parametersToJsonSchema,
} from '@agentbouncr/core';
import type { GovernanceTool, GovernanceToolParameter } from '@agentbouncr/core';

describe('Canonical Tool Schema', () => {
  const validTool: GovernanceTool = {
    name: 'file_write',
    description: 'Write content to a file',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Target file path',
      },
      {
        name: 'content',
        type: 'string',
        required: true,
        description: 'File content',
      },
      {
        name: 'overwrite',
        type: 'boolean',
        required: false,
        default: false,
      },
    ],
    riskLevel: 'high',
    category: 'filesystem',
    source: 'manual',
    version: '1.0',
    tags: ['io', 'write'],
    timeout: 5000,
  };

  describe('riskLevelSchema', () => {
    it('should accept valid risk levels', () => {
      for (const level of ['critical', 'high', 'medium', 'low']) {
        expect(riskLevelSchema.safeParse(level).success).toBe(true);
      }
    });

    it('should reject invalid risk levels', () => {
      expect(riskLevelSchema.safeParse('unknown').success).toBe(false);
    });
  });

  describe('toolSourceSchema', () => {
    it('should accept valid sources', () => {
      for (const source of ['manual', 'import', 'mcp']) {
        expect(toolSourceSchema.safeParse(source).success).toBe(true);
      }
    });

    it('should reject invalid sources', () => {
      expect(toolSourceSchema.safeParse('api').success).toBe(false);
    });
  });

  describe('governanceToolParameterSchema', () => {
    it('should validate a simple parameter', () => {
      const param: GovernanceToolParameter = {
        name: 'path',
        type: 'string',
        required: true,
        description: 'File path',
      };
      expect(governanceToolParameterSchema.safeParse(param).success).toBe(true);
    });

    it('should validate nested object parameters', () => {
      const param: GovernanceToolParameter = {
        name: 'config',
        type: 'object',
        required: true,
        children: [
          { name: 'key', type: 'string', required: true },
          { name: 'value', type: 'string', required: false },
        ],
      };
      expect(governanceToolParameterSchema.safeParse(param).success).toBe(true);
    });

    it('should validate parameters with constraints', () => {
      const param: GovernanceToolParameter = {
        name: 'amount',
        type: 'number',
        required: true,
        constraints: {
          min: 0,
          max: 10000,
        },
      };
      expect(governanceToolParameterSchema.safeParse(param).success).toBe(true);
    });

    it('should reject empty name', () => {
      const param = { name: '', type: 'string', required: true };
      expect(governanceToolParameterSchema.safeParse(param).success).toBe(false);
    });

    it('should reject invalid type', () => {
      const param = { name: 'x', type: 'date', required: true };
      expect(governanceToolParameterSchema.safeParse(param).success).toBe(false);
    });
  });

  describe('governanceToolSchema', () => {
    it('should validate a complete tool definition', () => {
      expect(governanceToolSchema.safeParse(validTool).success).toBe(true);
    });

    it('should validate a minimal tool definition', () => {
      const minimal = {
        name: 'ping',
        parameters: [],
        riskLevel: 'low',
        source: 'manual',
      };
      expect(governanceToolSchema.safeParse(minimal).success).toBe(true);
    });

    it('should reject missing name', () => {
      const { name: _, ...noName } = validTool;
      expect(governanceToolSchema.safeParse(noName).success).toBe(false);
    });

    it('should reject missing riskLevel', () => {
      const { riskLevel: _, ...noRisk } = validTool;
      expect(governanceToolSchema.safeParse(noRisk).success).toBe(false);
    });

    it('should reject missing source', () => {
      const { source: _, ...noSource } = validTool;
      expect(governanceToolSchema.safeParse(noSource).success).toBe(false);
    });

    it('should reject negative timeout', () => {
      const tool = { ...validTool, timeout: -1 };
      expect(governanceToolSchema.safeParse(tool).success).toBe(false);
    });

    it('should reject empty tool name', () => {
      const tool = { ...validTool, name: '' };
      expect(governanceToolSchema.safeParse(tool).success).toBe(false);
    });
  });

  describe('parametersToJsonSchema', () => {
    it('should convert simple parameters to JSON Schema', () => {
      const params: GovernanceToolParameter[] = [
        { name: 'path', type: 'string', required: true, description: 'File path' },
        { name: 'force', type: 'boolean', required: false, default: false },
      ];

      const schema = parametersToJsonSchema(params);

      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['path']);
      expect((schema.properties as Record<string, unknown>)['path']).toEqual({
        type: 'string',
        description: 'File path',
      });
      expect((schema.properties as Record<string, unknown>)['force']).toEqual({
        type: 'boolean',
        default: false,
      });
    });

    it('should omit required array when no params are required', () => {
      const params: GovernanceToolParameter[] = [
        { name: 'verbose', type: 'boolean', required: false },
      ];

      const schema = parametersToJsonSchema(params);
      expect(schema.required).toBeUndefined();
    });

    it('should convert constraints to JSON Schema', () => {
      const params: GovernanceToolParameter[] = [
        {
          name: 'amount',
          type: 'number',
          required: true,
          constraints: { min: 0, max: 10000 },
        },
        {
          name: 'currency',
          type: 'string',
          required: true,
          constraints: { enum: ['EUR', 'USD', 'GBP'] },
        },
      ];

      const schema = parametersToJsonSchema(params);
      const props = schema.properties as Record<string, Record<string, unknown>>;

      expect(props['amount'].minimum).toBe(0);
      expect(props['amount'].maximum).toBe(10000);
      expect(props['currency'].enum).toEqual(['EUR', 'USD', 'GBP']);
    });

    it('should handle nested object parameters', () => {
      const params: GovernanceToolParameter[] = [
        {
          name: 'config',
          type: 'object',
          required: true,
          children: [
            { name: 'key', type: 'string', required: true },
            { name: 'value', type: 'string', required: false },
          ],
        },
      ];

      const schema = parametersToJsonSchema(params);
      const config = (schema.properties as Record<string, Record<string, unknown>>)['config'];

      expect(config.type).toBe('object');
      expect(config.properties).toBeDefined();
      expect(config.required).toEqual(['key']);
    });

    it('should handle array parameters with item type', () => {
      const params: GovernanceToolParameter[] = [
        {
          name: 'tags',
          type: 'array',
          required: false,
          children: [{ name: 'item', type: 'string', required: false }],
        },
      ];

      const schema = parametersToJsonSchema(params);
      const tags = (schema.properties as Record<string, Record<string, unknown>>)['tags'];

      expect(tags.type).toBe('array');
      expect(tags.items).toEqual({ type: 'string' });
    });

    it('should return empty schema for no parameters', () => {
      const schema = parametersToJsonSchema([]);
      expect(schema).toEqual({ type: 'object', properties: {} });
    });

    it('should convert maxLength and pattern constraints to JSON Schema', () => {
      const params: GovernanceToolParameter[] = [
        {
          name: 'email',
          type: 'string',
          required: true,
          constraints: { maxLength: 255, pattern: '^[^@]+@[^@]+$' },
        },
      ];

      const schema = parametersToJsonSchema(params);
      const props = schema.properties as Record<string, Record<string, unknown>>;

      expect(props['email'].maxLength).toBe(255);
      expect(props['email'].pattern).toBe('^[^@]+@[^@]+$');
    });
  });
});
