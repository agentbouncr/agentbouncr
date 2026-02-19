/**
 * Claims Processor Example — Agent Governance Framework
 *
 * Demonstrates: SQLite persistence, agent lifecycle, policies with
 * conditions, event listeners, and the kill-switch.
 *
 * Run: npx tsx examples/claims-processor.ts
 */

import { join } from 'node:path';
import pino from 'pino';
import { GovernanceMiddleware } from '@agentbouncr/core';
import type { Policy } from '@agentbouncr/core';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';

const logger = pino({ level: 'silent' });
const migrationsDir = join(import.meta.dirname, '..', 'migrations');

// 1. Set up SQLite (in-memory for this demo)
const db = new SqliteDatabaseAdapter(logger, ':memory:', migrationsDir);
await db.runMigrations();

const governance = new GovernanceMiddleware({ db, logger });

// 2. Listen for denied tool calls
governance.on('tool_call.denied', (event) => {
  console.log(`  [EVENT] Denied: ${event.data?.tool} — ${event.data?.reason}`);
});

// 3. Register an agent
await governance.registerAgent({
  agentId: 'claims-agent',
  name: 'Insurance Claims Processor',
  description: 'Processes insurance claims and approves payments',
  allowedTools: ['search_claims', 'approve_payment', 'file_write'],
});
await governance.startAgent('claims-agent');

// 4. Define policy with conditions
const policy: Policy = {
  name: 'claims-policy',
  version: '1.0',
  rules: [
    {
      name: 'block-high-value',
      tool: 'approve_payment',
      effect: 'deny',
      condition: { amount: { gt: 5000 } },
      reason: 'Payments over 5000 require manual approval',
    },
    {
      name: 'block-etc',
      tool: 'file_write',
      effect: 'deny',
      condition: { path: { startsWith: '/etc/' } },
      reason: 'Writing to /etc/ is not permitted',
    },
    { tool: '*', effect: 'allow' },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
governance.setPolicy(policy);

// 5. Evaluate tool calls
console.log('=== Claims Processor Demo ===\n');

const r1 = await governance.evaluate({
  agentId: 'claims-agent',
  tool: 'search_claims',
  params: { customerId: 'C-1234' },
});
console.log(`search_claims:        ${r1.allowed ? 'ALLOWED' : 'DENIED'}`);

const r2 = await governance.evaluate({
  agentId: 'claims-agent',
  tool: 'approve_payment',
  params: { amount: 2500, currency: 'EUR' },
});
console.log(`approve_payment 2500: ${r2.allowed ? 'ALLOWED' : 'DENIED'}`);

const r3 = await governance.evaluate({
  agentId: 'claims-agent',
  tool: 'approve_payment',
  params: { amount: 7500, currency: 'EUR' },
});
console.log(`approve_payment 7500: ${r3.allowed ? 'ALLOWED' : 'DENIED'}`);

// 6. Kill-Switch demo
console.log('\n=== Kill-Switch Demo ===\n');

governance.emergencyStop('Suspicious activity detected');
console.log(`Kill-Switch active: ${governance.isKillSwitchActive()}`);

const r4 = await governance.evaluate({
  agentId: 'claims-agent',
  tool: 'search_claims',
  params: { customerId: 'C-5678' },
});
console.log(`search_claims (kill): ${r4.allowed ? 'ALLOWED' : 'DENIED'}`);

governance.resetKillSwitch();
console.log(`Kill-Switch reset:  ${!governance.isKillSwitchActive()}`);

const r5 = await governance.evaluate({
  agentId: 'claims-agent',
  tool: 'search_claims',
  params: { customerId: 'C-5678' },
});
console.log(`search_claims (ok):   ${r5.allowed ? 'ALLOWED' : 'DENIED'}`);

// 7. Agent status
console.log('\n=== Agent Status ===\n');
const agents = await governance.listAgents();
for (const agent of agents) {
  console.log(`  ${agent.agentId}: ${agent.status} (since ${agent.registeredAt})`);
}

await governance.stopAgent('claims-agent');
const status = await governance.getAgentStatus('claims-agent');
console.log(`  ${status?.agentId}: ${status?.status}`);

// Cleanup
await db.close();
