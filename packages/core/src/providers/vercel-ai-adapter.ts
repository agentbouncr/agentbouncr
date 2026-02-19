/**
 * @agentbouncr/core — Vercel AI SDK Adapter
 *
 * Wraps Vercel AI SDK tools with governance checks.
 * Uses structural typing — NO dependency on the 'ai' package.
 *
 * Before each tool execution:
 * 1. PolicyEngine.evaluate() is called
 * 2. Events are emitted (tool_call.allowed / tool_call.denied / tool_call.error)
 * 3. On deny: GovernanceError is thrown, execute is NOT called
 */

import type pino from 'pino';
import type { Policy, EvaluateRequest } from '../types/index.js';
import { GovernanceError } from '../types/index.js';
import type { PolicyEngine } from '../core/policy-engine.js';
import type { GovernanceEventEmitter } from '../events/event-emitter.js';

// --- Structural types (compatible with Vercel AI SDK without importing 'ai') ---

export interface AITool {
  type?: 'function';
  description?: string;
  parameters: unknown;
  execute?: (
    params: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => PromiseLike<unknown>;
}

export type AIToolSet = Record<string, AITool>;

export interface GovernanceWrapOptions {
  agentId: string;
  policyEngine: PolicyEngine;
  policy: Policy;
  eventEmitter?: GovernanceEventEmitter;
  logger: pino.Logger;
}

/**
 * Wrap Vercel AI SDK tools with governance checks.
 *
 * Each tool's execute function is intercepted:
 * - PolicyEngine.evaluate() runs BEFORE the original execute
 * - On deny: throws GovernanceError, original execute is NEVER called
 * - On allow: calls original execute, returns result
 * - On error: emits tool_call.error, throws GovernanceError
 *
 * Tools without execute (description-only) are returned unchanged.
 */
export function wrapToolsWithGovernance(
  tools: AIToolSet,
  options: GovernanceWrapOptions,
): AIToolSet {
  const wrapped: AIToolSet = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[toolName] = tool;
      continue;
    }

    wrapped[toolName] = {
      ...tool,
      execute: createGovernedExecute(toolName, tool.execute, options),
    };
  }

  return wrapped;
}

function createGovernedExecute(
  toolName: string,
  originalExecute: NonNullable<AITool['execute']>,
  options: GovernanceWrapOptions,
): NonNullable<AITool['execute']> {
  const { agentId, policyEngine, policy, eventEmitter, logger } = options;

  return async (
    params: Record<string, unknown>,
    executeOptions?: Record<string, unknown>,
  ): Promise<unknown> => {
    const request: EvaluateRequest = {
      agentId,
      tool: toolName,
      params,
    };

    const evaluation = policyEngine.evaluate(request, policy);

    if (!evaluation.allowed) {
      logger.warn(
        { agentId, tool: toolName, traceId: evaluation.traceId, reason: evaluation.reason },
        'Tool call denied by governance',
      );

      eventEmitter?.emitEvent({
        type: 'tool_call.denied',
        timestamp: new Date().toISOString(),
        traceId: evaluation.traceId,
        agentId,
        data: {
          tool: toolName,
          params,
          reason: evaluation.reason,
          appliedRules: evaluation.appliedRules,
        },
      });

      throw new GovernanceError(
        evaluation.reason ?? `Tool '${toolName}' denied by policy`,
        'POLICY_DENIED',
        'policy_denial',
        { agentId, tool: toolName, traceId: evaluation.traceId },
      );
    }

    // Allowed — emit event and execute
    eventEmitter?.emitEvent({
      type: 'tool_call.allowed',
      timestamp: new Date().toISOString(),
      traceId: evaluation.traceId,
      agentId,
      data: {
        tool: toolName,
        params,
        appliedRules: evaluation.appliedRules,
      },
    });

    try {
      const result = await originalExecute(params, executeOptions);
      return result;
    } catch (err: unknown) {
      logger.error(
        { agentId, tool: toolName, traceId: evaluation.traceId, error: String(err) },
        'Tool execution failed',
      );

      eventEmitter?.emitEvent({
        type: 'tool_call.error',
        timestamp: new Date().toISOString(),
        traceId: evaluation.traceId,
        agentId,
        data: {
          tool: toolName,
          params,
          error: String(err),
        },
      });

      throw new GovernanceError(
        'Tool execution failed',
        'TOOL_EXECUTION_ERROR',
        'tool_error',
        { agentId, tool: toolName, traceId: evaluation.traceId, originalError: String(err) },
      );
    }
  };
}
