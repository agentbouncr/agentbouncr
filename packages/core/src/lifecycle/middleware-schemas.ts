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
  agentId: z.string().min(1).max(128),
  tool: z.string().min(1).max(256),
  params: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().max(256).optional(),
});

// --- AgentConfig Schema ---

export const agentConfigSchema = z.object({
  agentId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  allowedTools: z.array(z.string().max(256)).default([]),
  policyName: z.string().max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// --- Dry-Run Request Schema ---

export const dryRunRequestSchema = z.object({
  agentId: z.string().min(1).max(128),
  tool: z.string().min(1).max(256),
  params: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().max(256).optional(),
  policy: policySchema,
});
