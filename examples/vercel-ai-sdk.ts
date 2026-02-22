/**
 * Vercel AI SDK Integration — AgentBouncr
 *
 * Shows how to wrap Vercel AI SDK tools with governance checks.
 * Every tool call is evaluated against your policy BEFORE execution.
 * Denied tools throw GovernanceError — the original execute() is never called.
 *
 * Prerequisites:
 *   npm install ai @ai-sdk/openai @agentbouncr/core pino
 *   export OPENAI_API_KEY=sk-...
 *
 * Run: npx tsx examples/vercel-ai-sdk.ts
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import pino from 'pino';
import {
  GovernanceMiddleware,
  PolicyEngine,
  wrapToolsWithGovernance,
  GovernanceError,
} from '@agentbouncr/core';
import type { Policy, AIToolSet } from '@agentbouncr/core';

const logger = pino({ level: 'info' });

// --- 1. Define your tools (standard Vercel AI SDK pattern) ---

const myTools = {
  searchClaims: tool({
    description: 'Search insurance claims by keyword',
    parameters: z.object({
      query: z.string().describe('Search query'),
    }),
    execute: async ({ query }) => {
      return { results: [`CLM-1001: Water damage (${query})`, `CLM-1002: Fire (${query})`] };
    },
  }),

  approvePayment: tool({
    description: 'Approve a payment for a claim',
    parameters: z.object({
      claimId: z.string().describe('Claim ID'),
      amount: z.number().describe('Payment amount in EUR'),
    }),
    execute: async ({ claimId, amount }) => {
      return { approved: true, claimId, amount, timestamp: new Date().toISOString() };
    },
  }),
};

// --- 2. Set up governance ---

const governance = new GovernanceMiddleware({ logger });

const policy: Policy = {
  name: 'claims-policy',
  version: '1.0',
  rules: [
    {
      tool: 'approvePayment',
      effect: 'deny',
      condition: { amount: { gt: 5000 } },
      reason: 'Payments over 5,000 EUR require manual approval',
    },
    { tool: '*', effect: 'allow' },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

governance.setPolicy(policy);

// --- 3. Wrap tools with governance ---

const governedTools = wrapToolsWithGovernance(myTools as unknown as AIToolSet, {
  agentId: 'claims-agent',
  policyEngine: new PolicyEngine(logger),
  policy,
  logger,
});

// --- 4. Use with Vercel AI SDK ---

try {
  // This will work — searchClaims is allowed
  const searchResult = await generateText({
    model: openai('gpt-4o'),
    tools: governedTools,
    toolChoice: { type: 'tool', toolName: 'searchClaims' },
    prompt: 'Search for water damage claims',
  });
  console.log('Search result:', searchResult.toolResults);
} catch (err) {
  if (err instanceof GovernanceError) {
    console.error('Governance blocked:', err.message);
  } else {
    throw err;
  }
}

try {
  // This will be BLOCKED — payment over 5,000 EUR
  const paymentResult = await generateText({
    model: openai('gpt-4o'),
    tools: governedTools,
    toolChoice: { type: 'tool', toolName: 'approvePayment' },
    prompt: 'Approve payment of 12,000 EUR for claim CLM-4821',
  });
  console.log('Payment result:', paymentResult.toolResults);
} catch (err) {
  if (err instanceof GovernanceError) {
    // Expected: "Payments over 5,000 EUR require manual approval"
    console.log('Payment blocked by governance:', err.message);
  } else {
    throw err;
  }
}
