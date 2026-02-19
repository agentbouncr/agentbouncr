/**
 * @agentbouncr/core — JSON Schema → GovernanceToolParameter Converter
 *
 * Reverse of parametersToJsonSchema() (tool-schema.ts).
 * Converts standard JSON Schema objects to the canonical GovernanceToolParameter[] format.
 * Used by all import adapters (MCP, OpenAI, LangChain).
 */

import type { GovernanceToolParameter, ToolParameterConstraints } from '../schema/tool-schema.js';

// --- Prototype pollution protection ---

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// --- Type mapping ---

const JSON_SCHEMA_TYPE_MAP: Record<string, GovernanceToolParameter['type']> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
};

/**
 * Convert a JSON Schema object to GovernanceToolParameter[].
 *
 * Expects a top-level `{ type: "object", properties: {...}, required: [...] }` schema.
 * Returns empty array for non-object schemas or missing properties.
 */
export function jsonSchemaToParameters(
  schema: Record<string, unknown>,
): GovernanceToolParameter[] {
  if (!schema || typeof schema !== 'object') return [];

  const schemaType = schema.type as string | undefined;
  if (schemaType !== 'object' && schemaType !== undefined) return [];

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties || typeof properties !== 'object') return [];

  const requiredFields = Array.isArray(schema.required) ? (schema.required as string[]) : [];

  return Object.entries(properties)
    .filter(([name]) => !RESERVED_KEYS.has(name))
    .map(([name, prop]) => convertProperty(name, prop, requiredFields.includes(name)));
}

function convertProperty(
  name: string,
  prop: Record<string, unknown>,
  required: boolean,
): GovernanceToolParameter {
  const rawType = prop.type as string | undefined;
  const type: GovernanceToolParameter['type'] = JSON_SCHEMA_TYPE_MAP[rawType ?? ''] ?? 'string';

  const param: GovernanceToolParameter = { name, type, required };

  if (typeof prop.description === 'string') {
    param.description = prop.description;
  }

  if (prop.default !== undefined) {
    param.default = prop.default;
  }

  const constraints = extractConstraints(prop);
  if (constraints) {
    param.constraints = constraints;
  }

  // Nested object → recursive children
  if (type === 'object' && prop.properties) {
    param.children = jsonSchemaToParameters(prop as Record<string, unknown>);
  }

  // Array → items as single child
  if (type === 'array' && prop.items && typeof prop.items === 'object') {
    const items = prop.items as Record<string, unknown>;
    const itemType: GovernanceToolParameter['type'] =
      JSON_SCHEMA_TYPE_MAP[items.type as string ?? ''] ?? 'string';
    param.children = [{
      name: 'items',
      type: itemType,
      required: false,
      ...(typeof items.description === 'string' ? { description: items.description } : {}),
    }];
  }

  return param;
}

function extractConstraints(
  prop: Record<string, unknown>,
): ToolParameterConstraints | undefined {
  const constraints: ToolParameterConstraints = {};
  let hasConstraints = false;

  if (Array.isArray(prop.enum)) {
    constraints.enum = prop.enum as (string | number)[];
    hasConstraints = true;
  }

  if (typeof prop.minimum === 'number') {
    constraints.min = prop.minimum;
    hasConstraints = true;
  }

  if (typeof prop.maximum === 'number') {
    constraints.max = prop.maximum;
    hasConstraints = true;
  }

  if (typeof prop.maxLength === 'number') {
    constraints.maxLength = prop.maxLength;
    hasConstraints = true;
  }

  if (typeof prop.pattern === 'string') {
    constraints.pattern = prop.pattern;
    hasConstraints = true;
  }

  return hasConstraints ? constraints : undefined;
}
