/**
 * @agentbouncr/core — Tool Registry
 *
 * Manages tool registrations and provides vendor-agnostic tool definitions.
 * Uses dependency injection (no singletons).
 */

import type pino from 'pino';
import type { GovernanceTool } from '../schema/tool-schema.js';
import { parametersToJsonSchema } from '../schema/tool-schema.js';

export interface ProviderToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, GovernanceTool>();

  constructor(private readonly logger: pino.Logger) {}

  register(tool: GovernanceTool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn({ tool: tool.name }, 'Tool already registered, overwriting');
    }
    this.tools.set(tool.name, tool);
    this.logger.info({ tool: tool.name, riskLevel: tool.riskLevel }, 'Tool registered');
  }

  get(name: string): GovernanceTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): GovernanceTool[] {
    return Array.from(this.tools.values());
  }

  getToolsForAgent(allowedTools: string[]): GovernanceTool[] {
    return allowedTools
      .map((name) => this.tools.get(name))
      .filter((tool): tool is GovernanceTool => tool !== undefined);
  }

  /**
   * Convert tools to provider-agnostic JSON Schema format.
   * Adapters (Vercel AI SDK, OpenAI, etc.) consume this format.
   */
  toProviderTools(allowedTools: string[]): ProviderToolDefinition[] {
    return this.getToolsForAgent(allowedTools).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      input_schema: parametersToJsonSchema(tool.parameters),
    }));
  }

  count(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }
}
