/**
 * @agentbouncr/core — Canonical Governance Tool Schema
 *
 * Einheitliches Tool-Format fuer alle Adapter (MCP, Vercel AI SDK, OpenAI, LangChain, n8n).
 * Zod-Schemas fuer Runtime-Validierung, TypeScript-Types per Inference.
 */

import { z } from 'zod/v4';

// --- Risk Level ---

export const riskLevelSchema = z.enum(['critical', 'high', 'medium', 'low']);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

// --- Tool Source ---

export const toolSourceSchema = z.enum(['manual', 'import', 'mcp']);
export type ToolSource = z.infer<typeof toolSourceSchema>;

// --- Parameter Constraints ---

export const toolParameterConstraintsSchema = z.object({
  enum: z.array(z.union([z.string(), z.number()])).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  jsonSchema: z.record(z.string(), z.unknown()).optional(),
});

export type ToolParameterConstraints = z.infer<typeof toolParameterConstraintsSchema>;

// --- Tool Parameter (recursive for nested objects) ---

export const governanceToolParameterSchema: z.ZodType<GovernanceToolParameter> = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  required: z.boolean(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  children: z.lazy(() => z.array(governanceToolParameterSchema)).optional(),
  constraints: toolParameterConstraintsSchema.optional(),
});

export interface GovernanceToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
  default?: unknown;
  children?: GovernanceToolParameter[];
  constraints?: ToolParameterConstraints;
}

// --- Governance Tool ---

export const governanceToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.array(governanceToolParameterSchema),
  riskLevel: riskLevelSchema,
  category: z.string().optional(),
  source: toolSourceSchema,
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
});

export type GovernanceTool = z.infer<typeof governanceToolSchema>;

// --- Utility: Convert GovernanceToolParameter[] to JSON Schema ---

export function parametersToJsonSchema(
  params: GovernanceToolParameter[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of params) {
    const prop: Record<string, unknown> = { type: param.type };

    if (param.description) {
      prop.description = param.description;
    }

    if (param.default !== undefined) {
      prop.default = param.default;
    }

    if (param.constraints) {
      if (param.constraints.enum) prop.enum = param.constraints.enum;
      if (param.constraints.min !== undefined) prop.minimum = param.constraints.min;
      if (param.constraints.max !== undefined) prop.maximum = param.constraints.max;
      if (param.constraints.maxLength !== undefined) prop.maxLength = param.constraints.maxLength;
      if (param.constraints.pattern) prop.pattern = param.constraints.pattern;
    }

    if (param.type === 'object' && param.children) {
      const nested = parametersToJsonSchema(param.children);
      prop.properties = nested.properties;
      if ((nested.required as string[])?.length > 0) {
        prop.required = nested.required;
      }
    }

    if (param.type === 'array' && param.children?.length === 1) {
      prop.items = { type: param.children[0].type };
    }

    properties[param.name] = prop;

    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    type: 'object' as const,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}
