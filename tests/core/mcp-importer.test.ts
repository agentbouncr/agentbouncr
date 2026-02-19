import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { importMCPTools } from '@agentbouncr/core';
import type { MCPToolDefinition } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

describe('MCP Import Adapter', () => {
  describe('importMCPTools — basic', () => {
    it('should import a single MCP tool', () => {
      const tools: MCPToolDefinition[] = [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          inputSchema: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'City name' },
            },
            required: ['city'],
          },
        },
      ];
      const result = importMCPTools(tools);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('get_weather');
      expect(result[0].description).toBe('Get weather for a city');
      expect(result[0].source).toBe('mcp');
      expect(result[0].riskLevel).toBe('medium');
      expect(result[0].parameters).toHaveLength(1);
      expect(result[0].parameters[0].name).toBe('city');
      expect(result[0].parameters[0].required).toBe(true);
    });

    it('should import multiple MCP tools', () => {
      const tools: MCPToolDefinition[] = [
        { name: 'tool_a', description: 'Tool A' },
        { name: 'tool_b', description: 'Tool B' },
        { name: 'tool_c', description: 'Tool C' },
      ];
      const result = importMCPTools(tools);
      expect(result).toHaveLength(3);
      expect(result.map((t) => t.name)).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });

    it('should import minimal tool (name only)', () => {
      const tools: MCPToolDefinition[] = [{ name: 'simple_tool' }];
      const result = importMCPTools(tools);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('simple_tool');
      expect(result[0].description).toBeUndefined();
      expect(result[0].parameters).toEqual([]);
      expect(result[0].source).toBe('mcp');
    });
  });

  describe('importMCPTools — riskLevel', () => {
    it('should use default riskLevel medium', () => {
      const result = importMCPTools([{ name: 'tool' }]);
      expect(result[0].riskLevel).toBe('medium');
    });

    it('should use custom riskLevel from options', () => {
      const result = importMCPTools([{ name: 'tool' }], { defaultRiskLevel: 'critical' });
      expect(result[0].riskLevel).toBe('critical');
    });

    it('should apply same riskLevel to all tools', () => {
      const tools: MCPToolDefinition[] = [
        { name: 'a' },
        { name: 'b' },
      ];
      const result = importMCPTools(tools, { defaultRiskLevel: 'high' });
      expect(result.every((t) => t.riskLevel === 'high')).toBe(true);
    });
  });

  describe('importMCPTools — source', () => {
    it('should always set source to mcp', () => {
      const result = importMCPTools([{ name: 'tool' }]);
      expect(result[0].source).toBe('mcp');
    });
  });

  describe('importMCPTools — inputSchema conversion', () => {
    it('should convert complex inputSchema with nested objects', () => {
      const tools: MCPToolDefinition[] = [
        {
          name: 'complex_tool',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              options: {
                type: 'object',
                properties: {
                  limit: { type: 'integer', minimum: 1, maximum: 100 },
                  format: { type: 'string', enum: ['json', 'xml'] },
                },
                required: ['limit'],
              },
            },
            required: ['query'],
          },
        },
      ];
      const result = importMCPTools(tools);
      expect(result[0].parameters).toHaveLength(2);

      const query = result[0].parameters.find((p) => p.name === 'query');
      expect(query?.type).toBe('string');
      expect(query?.required).toBe(true);

      const options = result[0].parameters.find((p) => p.name === 'options');
      expect(options?.type).toBe('object');
      expect(options?.children).toHaveLength(2);
      expect(options?.children?.find((c) => c.name === 'limit')?.required).toBe(true);
    });

    it('should handle tool without inputSchema', () => {
      const result = importMCPTools([{ name: 'no_params' }]);
      expect(result[0].parameters).toEqual([]);
    });

    it('should handle empty inputSchema', () => {
      const result = importMCPTools([{ name: 'empty', inputSchema: {} }]);
      expect(result[0].parameters).toEqual([]);
    });
  });

  describe('importMCPTools — invalid input', () => {
    it('should return empty array for empty list', () => {
      expect(importMCPTools([])).toEqual([]);
    });

    it('should return empty array for non-array input', () => {
      const result = importMCPTools('invalid' as unknown as MCPToolDefinition[], { logger: silentLogger });
      expect(result).toEqual([]);
    });

    it('should skip tool with empty name', () => {
      const tools = [
        { name: '', description: 'Bad tool' },
        { name: 'good_tool' },
      ];
      const result = importMCPTools(tools, { logger: silentLogger });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('good_tool');
    });

    it('should skip tool with whitespace-only name', () => {
      const tools = [
        { name: '   ', description: 'Whitespace name' },
        { name: 'valid_tool' },
      ];
      const result = importMCPTools(tools, { logger: silentLogger });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('valid_tool');
    });

    it('should skip tool with missing name', () => {
      const tools = [
        { description: 'No name' } as unknown as MCPToolDefinition,
        { name: 'valid' },
      ];
      const result = importMCPTools(tools, { logger: silentLogger });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('valid');
    });

    it('should skip null entries', () => {
      const tools = [null, { name: 'valid' }] as unknown as MCPToolDefinition[];
      const result = importMCPTools(tools, { logger: silentLogger });
      expect(result).toHaveLength(1);
    });

    it('should log warning for skipped tools', () => {
      const warnSpy = vi.fn();
      const mockLogger = { warn: warnSpy } as unknown as pino.Logger;

      importMCPTools([{ name: '' }], { logger: mockLogger });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('importMCPTools — name and description', () => {
    it('should preserve tool name exactly', () => {
      const result = importMCPTools([{ name: 'my-special_tool.v2' }]);
      expect(result[0].name).toBe('my-special_tool.v2');
    });

    it('should preserve description exactly', () => {
      const desc = 'A tool that does something very specific with unicode: äöü';
      const result = importMCPTools([{ name: 'tool', description: desc }]);
      expect(result[0].description).toBe(desc);
    });

    it('should handle non-string description gracefully', () => {
      const tools = [{ name: 'tool', description: 42 }] as unknown as MCPToolDefinition[];
      const result = importMCPTools(tools);
      expect(result[0].description).toBeUndefined();
    });
  });
});
