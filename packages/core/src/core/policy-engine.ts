/**
 * @agentbouncr/core — Policy Engine
 *
 * Evaluates tool-call requests against JSON policies.
 * Deterministic — no LLM, no randomness.
 * Fail-Secure — errors result in denial.
 *
 * Priority: tool+condition > tool-only > wildcard(*)
 * Tiebreaker: deny before allow at equal specificity.
 *
 * rateLimit field is accepted but NOT evaluated in Stufe 1.
 * requireApproval is surfaced in appliedRules for GovernanceMiddleware.
 */

import type pino from 'pino';
import type {
  Policy,
  PolicyRule,
  EvaluateRequest,
  EvaluateResult,
  AppliedRule,
} from '../types/index.js';
import { evaluateCondition } from './condition-evaluator.js';
import { generateTraceId } from '../tracing/trace-context.js';

// --- Specificity Tiers ---

const SPECIFICITY_WILDCARD = 0;
const SPECIFICITY_TOOL_ONLY = 1;
const SPECIFICITY_TOOL_CONDITION = 2;

// --- Internal types ---

interface RuleMatch {
  rule: PolicyRule;
  policyName: string;
  specificity: number;
}

// --- Policy Engine ---

export class PolicyEngine {
  constructor(private readonly logger: pino.Logger) {}

  /**
   * Evaluate a tool-call request against a policy.
   *
   * No policy = deny (fail-secure).
   * No matching rules = deny (fail-secure).
   * Internal error = deny (fail-secure).
   */
  evaluate(request: EvaluateRequest, policy: Policy | null): EvaluateResult {
    const traceId = request.traceId ?? generateTraceId();

    try {
      if (!policy) {
        this.logger.warn(
          { agentId: request.agentId, tool: request.tool, traceId },
          'No policy found — denying (fail-secure)',
        );
        return {
          allowed: false,
          traceId,
          reason: `No policy found for agent '${request.agentId}'`,
          appliedRules: [],
        };
      }

      const matches = this.findMatchingRules(policy, request);

      if (matches.length === 0) {
        this.logger.info(
          { agentId: request.agentId, tool: request.tool, policyName: policy.name, traceId },
          'No matching rules — denying (fail-secure)',
        );
        return {
          allowed: false,
          traceId,
          reason: `No matching rule for tool '${request.tool}' in policy '${policy.name}'`,
          appliedRules: [],
        };
      }

      const sorted = this.sortByPriority(matches);
      const winner = sorted[0];
      const allowed = winner.rule.effect === 'allow';

      const appliedRules: AppliedRule[] = sorted.map((m) => ({
        policyName: m.policyName,
        ruleName: m.rule.name,
        effect: m.rule.effect,
        requireApproval: m.rule.requireApproval,
      }));

      if (allowed) {
        this.logger.info(
          { agentId: request.agentId, tool: request.tool, policyName: policy.name, traceId },
          'Tool call allowed by policy',
        );
      } else {
        this.logger.warn(
          {
            agentId: request.agentId,
            tool: request.tool,
            policyName: policy.name,
            ruleName: winner.rule.name,
            reason: winner.rule.reason,
            traceId,
          },
          'Tool call denied by policy',
        );
      }

      return { allowed, traceId, reason: winner.rule.reason, appliedRules };
    } catch (err: unknown) {
      this.logger.error(
        { agentId: request.agentId, tool: request.tool, error: String(err), traceId },
        'Policy evaluation failed — denying (fail-secure)',
      );
      return {
        allowed: false,
        traceId,
        reason: `Policy evaluation failed: ${String(err)}`,
        appliedRules: [],
      };
    }
  }

  private findMatchingRules(policy: Policy, request: EvaluateRequest): RuleMatch[] {
    const matches: RuleMatch[] = [];

    for (const rule of policy.rules) {
      const toolMatches = rule.tool === request.tool || rule.tool === '*';
      if (!toolMatches) continue;

      if (!evaluateCondition(rule.condition, request.params)) continue;

      matches.push({
        rule,
        policyName: policy.name,
        specificity: this.computeSpecificity(rule),
      });
    }

    return matches;
  }

  private computeSpecificity(rule: PolicyRule): number {
    if (rule.tool === '*') return SPECIFICITY_WILDCARD;
    if (rule.condition && Object.keys(rule.condition).length > 0) {
      const hasOperators = Object.values(rule.condition).some(
        (ops) => Object.keys(ops).length > 0,
      );
      if (hasOperators) return SPECIFICITY_TOOL_CONDITION;
    }
    return SPECIFICITY_TOOL_ONLY;
  }

  /**
   * Sort: highest specificity first.
   * At equal specificity: deny before allow (fail-secure).
   */
  private sortByPriority(matches: RuleMatch[]): RuleMatch[] {
    return [...matches].sort((a, b) => {
      if (a.specificity !== b.specificity) {
        return b.specificity - a.specificity;
      }
      if (a.rule.effect !== b.rule.effect) {
        return a.rule.effect === 'deny' ? -1 : 1;
      }
      return 0;
    });
  }
}
