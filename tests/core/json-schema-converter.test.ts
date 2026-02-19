import { describe, it, expect } from 'vitest';
import { jsonSchemaToParameters, parametersToJsonSchema } from '@agentbouncr/core';
import type { GovernanceToolParameter } from '@agentbouncr/core';

describe('JSON Schema Converter', () => {
  describe('jsonSchemaToParameters — basic types', () => {
    it('should convert string property', () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('name');
      expect(result[0].type).toBe('string');
      expect(result[0].required).toBe(false);
    });

    it('should convert number property', () => {
      const schema = {
        type: 'object',
        properties: { age: { type: 'number' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('number');
    });

    it('should convert boolean property', () => {
      const schema = {
        type: 'object',
        properties: { active: { type: 'boolean' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('boolean');
    });

    it('should convert integer to number', () => {
      const schema = {
        type: 'object',
        properties: { count: { type: 'integer' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('number');
    });

    it('should convert object property', () => {
      const schema = {
        type: 'object',
        properties: { config: { type: 'object' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('object');
    });

    it('should convert array property', () => {
      const schema = {
        type: 'object',
        properties: { tags: { type: 'array' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('array');
    });

    it('should default unknown type to string', () => {
      const schema = {
        type: 'object',
        properties: { unknown: { type: 'null' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('string');
    });

    it('should default missing type to string', () => {
      const schema = {
        type: 'object',
        properties: { noType: {} },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('string');
    });
  });

  describe('jsonSchemaToParameters — required fields', () => {
    it('should mark required fields correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          bio: { type: 'string' },
        },
        required: ['name', 'age'],
      };
      const result = jsonSchemaToParameters(schema);
      const byName = Object.fromEntries(result.map((p) => [p.name, p]));
      expect(byName.name.required).toBe(true);
      expect(byName.age.required).toBe(true);
      expect(byName.bio.required).toBe(false);
    });

    it('should treat all as optional when required is missing', () => {
      const schema = {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result.every((p) => p.required === false)).toBe(true);
    });
  });

  describe('jsonSchemaToParameters — descriptions and defaults', () => {
    it('should extract description', () => {
      const schema = {
        type: 'object',
        properties: { city: { type: 'string', description: 'The city name' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].description).toBe('The city name');
    });

    it('should extract default value', () => {
      const schema = {
        type: 'object',
        properties: { limit: { type: 'number', default: 10 } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].default).toBe(10);
    });

    it('should not set description when absent', () => {
      const schema = {
        type: 'object',
        properties: { x: { type: 'string' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].description).toBeUndefined();
    });
  });

  describe('jsonSchemaToParameters — constraints', () => {
    it('should extract enum constraint', () => {
      const schema = {
        type: 'object',
        properties: { role: { type: 'string', enum: ['admin', 'user'] } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].constraints?.enum).toEqual(['admin', 'user']);
    });

    it('should extract min/max from minimum/maximum', () => {
      const schema = {
        type: 'object',
        properties: { age: { type: 'number', minimum: 0, maximum: 150 } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].constraints?.min).toBe(0);
      expect(result[0].constraints?.max).toBe(150);
    });

    it('should extract maxLength', () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string', maxLength: 100 } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].constraints?.maxLength).toBe(100);
    });

    it('should extract pattern', () => {
      const schema = {
        type: 'object',
        properties: { email: { type: 'string', pattern: '^[^@]+@[^@]+$' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].constraints?.pattern).toBe('^[^@]+@[^@]+$');
    });

    it('should not set constraints when none present', () => {
      const schema = {
        type: 'object',
        properties: { plain: { type: 'string' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].constraints).toBeUndefined();
    });
  });

  describe('jsonSchemaToParameters — nested objects', () => {
    it('should convert nested object with children', () => {
      const schema = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { type: 'string' },
            },
            required: ['street'],
          },
        },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('object');
      expect(result[0].children).toHaveLength(2);

      const children = result[0].children ?? [];
      const street = children.find((c) => c.name === 'street');
      expect(street?.required).toBe(true);
      const city = children.find((c) => c.name === 'city');
      expect(city?.required).toBe(false);
    });
  });

  describe('jsonSchemaToParameters — arrays', () => {
    it('should convert array with items type', () => {
      const schema = {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('array');
      expect(result[0].children).toHaveLength(1);
      expect((result[0].children ?? [])[0].type).toBe('string');
    });

    it('should handle array without items', () => {
      const schema = {
        type: 'object',
        properties: { data: { type: 'array' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result[0].type).toBe('array');
      expect(result[0].children).toBeUndefined();
    });
  });

  describe('jsonSchemaToParameters — edge cases', () => {
    it('should return empty array for empty schema', () => {
      expect(jsonSchemaToParameters({})).toEqual([]);
    });

    it('should return empty array for non-object schema type', () => {
      expect(jsonSchemaToParameters({ type: 'string' })).toEqual([]);
    });

    it('should return empty array for null input', () => {
      expect(jsonSchemaToParameters(null as unknown as Record<string, unknown>)).toEqual([]);
    });

    it('should return empty array for undefined input', () => {
      expect(jsonSchemaToParameters(undefined as unknown as Record<string, unknown>)).toEqual([]);
    });

    it('should filter out __proto__ and constructor property names', () => {
      const schema = {
        type: 'object',
        properties: {
          __proto__: { type: 'string' },
          constructor: { type: 'string' },
          prototype: { type: 'string' },
          safeName: { type: 'string' },
        },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('safeName');
    });

    it('should return empty array for schema without properties', () => {
      expect(jsonSchemaToParameters({ type: 'object' })).toEqual([]);
    });

    it('should return empty array for required-only without properties', () => {
      expect(jsonSchemaToParameters({ type: 'object', required: ['a'] })).toEqual([]);
    });

    it('should handle schema without explicit type (implicit object)', () => {
      const schema = {
        properties: { name: { type: 'string' } },
      };
      const result = jsonSchemaToParameters(schema);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('name');
    });
  });

  describe('jsonSchemaToParameters — roundtrip', () => {
    it('should produce equivalent schema via parametersToJsonSchema roundtrip', () => {
      const original: GovernanceToolParameter[] = [
        {
          name: 'query',
          type: 'string',
          required: true,
          description: 'Search query',
        },
        {
          name: 'limit',
          type: 'number',
          required: false,
          default: 10,
          constraints: { min: 1, max: 100 },
        },
        {
          name: 'active',
          type: 'boolean',
          required: true,
        },
      ];

      // GovernanceToolParameter[] → JSON Schema → GovernanceToolParameter[]
      const jsonSchema = parametersToJsonSchema(original);
      const roundtripped = jsonSchemaToParameters(jsonSchema);

      expect(roundtripped).toHaveLength(original.length);
      for (const orig of original) {
        const rt = roundtripped.find((p) => p.name === orig.name);
        expect(rt).toBeDefined();
        if (!rt) return;
        expect(rt.type).toBe(orig.type);
        expect(rt.required).toBe(orig.required);
        if (orig.description) expect(rt.description).toBe(orig.description);
        if (orig.default !== undefined) expect(rt.default).toBe(orig.default);
        if (orig.constraints?.min !== undefined) expect(rt.constraints?.min).toBe(orig.constraints.min);
        if (orig.constraints?.max !== undefined) expect(rt.constraints?.max).toBe(orig.constraints.max);
      }
    });

    it('should roundtrip array parameters with items', () => {
      const original: GovernanceToolParameter[] = [
        {
          name: 'tags',
          type: 'array',
          required: false,
          children: [{ name: 'items', type: 'string', required: false }],
        },
      ];

      const jsonSchema = parametersToJsonSchema(original);
      const roundtripped = jsonSchemaToParameters(jsonSchema);

      expect(roundtripped[0].type).toBe('array');
      expect(roundtripped[0].children).toHaveLength(1);
      expect((roundtripped[0].children ?? [])[0].type).toBe('string');
    });

    it('should roundtrip nested object parameters', () => {
      const original: GovernanceToolParameter[] = [
        {
          name: 'config',
          type: 'object',
          required: true,
          children: [
            { name: 'host', type: 'string', required: true },
            { name: 'port', type: 'number', required: false, default: 8080 },
          ],
        },
      ];

      const jsonSchema = parametersToJsonSchema(original);
      const roundtripped = jsonSchemaToParameters(jsonSchema);

      expect(roundtripped[0].type).toBe('object');
      const children = roundtripped[0].children ?? [];
      expect(children).toHaveLength(2);
      expect(children[0].name).toBe('host');
      expect(children[0].required).toBe(true);
    });
  });

  describe('jsonSchemaToParameters — multiple properties', () => {
    it('should convert all properties in a complex schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'integer', minimum: 0 },
          role: { type: 'string', enum: ['admin', 'user', 'guest'] },
          active: { type: 'boolean', default: true },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'role'],
      };
      const result = jsonSchemaToParameters(schema);
      expect(result).toHaveLength(5);

      const byName = Object.fromEntries(result.map((p) => [p.name, p]));
      expect(byName.name.type).toBe('string');
      expect(byName.name.required).toBe(true);
      expect(byName.age.type).toBe('number');
      expect(byName.age.constraints?.min).toBe(0);
      expect(byName.role.constraints?.enum).toEqual(['admin', 'user', 'guest']);
      expect(byName.active.default).toBe(true);
      expect(byName.tags.children).toHaveLength(1);
    });
  });
});
