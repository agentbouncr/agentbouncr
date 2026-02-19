/**
 * @agentbouncr/core — Zod Schemas for GovernanceMiddleware Inputs
 *
 * Runtime validation for EvaluateRequest and AgentConfig.
 * Policy validation re-uses policySchema from policy-schema.ts.
 */

import { z } from 'zod/v4';
import { policySchema } from '../core/policy-schema.js';

// --- EvaluateRequest Schema ---

export const evaluateRequestSchema = z.object({
  agentId: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
});

// --- AgentConfig Schema ---

export const agentConfigSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  allowedTools: z.array(z.string()).default([]),
  policyName: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// --- Dry-Run Request Schema ---

export const dryRunRequestSchema = z.object({
  agentId: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  policy: policySchema,
});
