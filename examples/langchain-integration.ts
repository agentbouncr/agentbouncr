/**
 * LangChain Integration — AgentBouncr
 *
 * Shows how to add governance to LangChain agents without a dedicated adapter.
 * The pattern: wrap each tool's execution with a governance.evaluate() check.
 *
 * This works with any LangChain tool type (DynamicStructuredTool, DynamicTool, etc.)
 * and any agent executor.
 *
 * Prerequisites:
 *   npm install @langchain/core @langchain/openai langchain @agentbouncr/core pino
 *   export OPENAI_API_KEY=sk-...
 *
 * Run: npx tsx examples/langchain-integration.ts
 */

import { z } from 'zod';
import pino from 'pino';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';
import { pull } from 'langchain/hub';
import type { ChatPromptTemplate } from '@langchain/core/prompts';
import { GovernanceMiddleware } from '@agentbouncr/core';
import type { Policy } from '@agentbouncr/core';

const logger = pino({ level: 'info' });

// --- 1. Set up governance ---

const governance = new GovernanceMiddleware({ logger });

const policy: Policy = {
  name: 'agent-policy',
  version: '1.0',
  rules: [
    {
      tool: 'approve_payment',
      effect: 'deny',
      condition: { amount: { gt: 5000 } },
      reason: 'Payments over 5,000 EUR require manual approval',
    },
    {
      tool: 'execute_shell',
      effect: 'deny',
      reason: 'Shell access is not permitted',
    },
    { tool: '*', effect: 'allow' },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

governance.setPolicy(policy);

// --- 2. Create a governance-aware wrapper for any LangChain tool ---

function withGovernance(tool: DynamicStructuredTool, agentId: string): DynamicStructuredTool {
  const originalFunc = tool.func.bind(tool);

  tool.func = async (input: Record<string, unknown>) => {
    // Check governance BEFORE executing the tool
    const result = await governance.evaluate({
      agentId,
      tool: tool.name,
      params: input,
    });

    if (!result.allowed) {
      return `[BLOCKED] ${result.reason}`;
    }

    return originalFunc(input);
  };

  return tool;
}

// --- 3. Define your tools ---

const AGENT_ID = 'claims-agent';

const searchClaims = withGovernance(
  new DynamicStructuredTool({
    name: 'search_claims',
    description: 'Search insurance claims by keyword',
    schema: z.object({
      query: z.string().describe('Search query'),
    }),
    func: async ({ query }) => {
      return JSON.stringify([
        { id: 'CLM-1001', type: 'Water damage', query },
        { id: 'CLM-1002', type: 'Fire', query },
      ]);
    },
  }),
  AGENT_ID,
);

const approvePayment = withGovernance(
  new DynamicStructuredTool({
    name: 'approve_payment',
    description: 'Approve a payment for a claim',
    schema: z.object({
      claimId: z.string().describe('Claim ID'),
      amount: z.number().describe('Payment amount in EUR'),
    }),
    func: async ({ claimId, amount }) => {
      return JSON.stringify({ approved: true, claimId, amount });
    },
  }),
  AGENT_ID,
);

// --- 4. Create the LangChain agent ---

const model = new ChatOpenAI({ modelName: 'gpt-4o', temperature: 0 });
const prompt = await pull<ChatPromptTemplate>('hwchase17/openai-functions-agent');
const tools = [searchClaims, approvePayment];

const agent = await createOpenAIFunctionsAgent({ llm: model, tools, prompt });
const executor = new AgentExecutor({ agent, tools, verbose: true });

// --- 5. Run the agent ---

// This will succeed — search is allowed
console.log('\n--- Searching claims ---');
const searchResult = await executor.invoke({
  input: 'Search for water damage claims',
});
console.log('Result:', searchResult.output);

// This will be blocked — payment over 5,000 EUR
console.log('\n--- Attempting large payment ---');
const paymentResult = await executor.invoke({
  input: 'Approve a payment of 12,000 EUR for claim CLM-4821',
});
console.log('Result:', paymentResult.output);
// → Agent receives "[BLOCKED] Payments over 5,000 EUR require manual approval"
