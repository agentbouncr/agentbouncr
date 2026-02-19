/**
 * @agentbouncr/core — Policy Validation Schema
 *
 * Zod schemas for runtime validation of Policy JSON.
 * validatePolicy() calls process.exit(1) on invalid input (Fail-Secure).
 */

import { z } from 'zod/v4';
import type pino from 'pino';

// --- Condition Schema ---

const conditionOperandSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

const VALID_OPERATORS = new Set([
  'equals', 'notEquals',
  'startsWith', 'endsWith', 'contains',
  'gt', 'lt', 'gte', 'lte',
  'in', 'matches',
]);

const conditionEntrySchema = z.record(
  z.string(),
  conditionOperandSchema,
).refine(
  (obj) => Object.keys(obj).every((key) => VALID_OPERATORS.has(key)),
  { message: 'Invalid condition operator. Valid: equals, notEquals, startsWith, endsWith, contains, gt, lt, gte, lte, in, matches' },
);

export const policyConditionSchema = z.record(
  z.string(),
  conditionEntrySchema,
);

// --- Rate Limit Schema (Stub for Stufe 2) ---

const rateLimitSchema = z.object({
  maxPerMinute: z.number().positive(),
});

// --- Policy Rule Schema ---

export const policyRuleSchema = z.object({
  name: z.string().optional(),
  tool: z.string().min(1),
  effect: z.enum(['allow', 'deny']),
  condition: policyConditionSchema.optional(),
  reason: z.string().optional(),
  rateLimit: rateLimitSchema.optional(),
  requireApproval: z.boolean().optional(),
});

// --- Policy Schema ---

export const policySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  agentId: z.string().optional(),
  rules: z.array(policyRuleSchema).min(1).max(1000),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// --- Validate-or-exit function (Fail-Secure) ---

/**
 * Validate a policy object. Returns the validated Policy on success.
 * Calls process.exit(1) on failure — invalid policy = agent MUST NOT start.
 */
export function validatePolicy(
  input: unknown,
  logger: pino.Logger,
): z.infer<typeof policySchema> {
  const result = policySchema.safeParse(input);
  if (!result.success) {
    logger.error(
      { errors: result.error.issues },
      'Invalid policy — agent cannot start (Fail-Secure)',
    );
    process.exit(1);
  }
  return result.data;
}
