/**
 * @agentbouncr/core — Permission Layer
 *
 * Checks before every tool call whether the agent has permission.
 * Decisions are deterministic — no LLM involved.
 * Uses dependency injection (ToolRegistry via constructor).
 */

import type pino from 'pino';
import type { PermissionResult } from '../types/index.js';
import type { ToolRegistry } from './tool-registry.js';

export class PermissionLayer {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly logger: pino.Logger,
  ) {}

  /**
   * Check if an agent has permission to use a tool.
   * Step 1: Tool must exist in registry.
   * Step 2: Tool must be in the agent's allowed tools list.
   *
   * Fail-Secure: Any internal error results in denial (never pass-through).
   */
  checkPermission(
    agentId: string,
    toolName: string,
    agentToolsList: string[],
  ): PermissionResult {
    try {
      // Step 1: Does the tool exist in the registry?
      if (!this.toolRegistry.has(toolName)) {
        this.logger.warn(
          { agentId, toolName, event: 'tool_not_found' },
          'Tool call denied: tool not registered',
        );
        return {
          allowed: false,
          reason: `Tool '${toolName}' is not registered`,
          toolName,
          agentId,
        };
      }

      // Step 2: Is the tool in the agent's allowed tools list?
      if (!agentToolsList.includes(toolName)) {
        this.logger.warn(
          { agentId, toolName, event: 'permission_denied' },
          'Tool call denied: not in agent permissions',
        );
        return {
          allowed: false,
          reason: `Agent '${agentId}' is not permitted to use '${toolName}'`,
          toolName,
          agentId,
        };
      }

      return { allowed: true, toolName, agentId };
    } catch (err: unknown) {
      // Fail-Secure: internal error = deny
      this.logger.error(
        { agentId, toolName, error: String(err), event: 'permission_check_error' },
        'Permission check failed — denying (fail-secure)',
      );
      return {
        allowed: false,
        reason: `Permission check failed: ${String(err)}`,
        toolName,
        agentId,
      };
    }
  }
}
