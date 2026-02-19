/**
 * @agentbouncr/core — MCP Import Adapter
 *
 * Converts MCP tool definitions (from tools/list response) to GovernanceTool[].
 * MCP = Model Context Protocol — emerging standard for agent tool definitions.
 *
 * Import priority: MCP first.
 */

import type pino from 'pino';
import type { GovernanceTool } from '../schema/tool-schema.js';
import type { RiskLevel } from '../schema/tool-schema.js';
import { jsonSchemaToParameters } from './json-schema-converter.js';

// --- MCP Types ---

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPImportOptions {
  /** Default risk level for imported tools. Default: 'medium' */
  defaultRiskLevel?: RiskLevel;
  /** Logger for skip-warnings on invalid tools */
  logger?: pino.Logger;
}

/**
 * Convert MCP tool definitions to GovernanceTool[].
 *
 * Invalid tools (missing/empty name) are skipped with a warning.
 * Empty input returns empty array.
 */
export function importMCPTools(
  toolList: MCPToolDefinition[],
  options?: MCPImportOptions,
): GovernanceTool[] {
  if (!Array.isArray(toolList)) {
    options?.logger?.warn({ input: typeof toolList }, 'importMCPTools: input is not an array — returning empty');
    return [];
  }

  const riskLevel = options?.defaultRiskLevel ?? 'medium';
  const result: GovernanceTool[] = [];

  for (const entry of toolList) {
    if (!entry || typeof entry !== 'object') {
      options?.logger?.warn({ entry }, 'importMCPTools: skipping non-object entry');
      continue;
    }

    if (!entry.name || typeof entry.name !== 'string' || entry.name.trim().length === 0) {
      options?.logger?.warn({ entry }, 'importMCPTools: skipping tool with missing or empty name');
      continue;
    }

    const parameters = entry.inputSchema
      ? jsonSchemaToParameters(entry.inputSchema)
      : [];

    result.push({
      name: entry.name,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      parameters,
      riskLevel,
      source: 'mcp',
    });
  }

  return result;
}
