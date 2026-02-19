/**
 * Quickstart Example — Agent Governance Framework
 *
 * Zero-Config: No database, no config files needed.
 * Run: npx tsx examples/quickstart.ts
 */

import pino from 'pino';
import { GovernanceMiddleware } from '@agentbouncr/core';
import type { Policy } from '@agentbouncr/core';

// 1. Create middleware (zero-config — default: allow-all, log everything)
const governance = new GovernanceMiddleware({
  logger: pino({ level: 'silent' }),
});

// 2. Define a policy: deny file_write to /etc/, allow everything else
const policy: Policy = {
  name: 'basic-security',
  version: '1.0',
  rules: [
    {
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

// 3. Evaluate tool calls
const allowed = await governance.evaluate({
  agentId: 'demo-agent',
  tool: 'search_web',
  params: { query: 'governance frameworks' },
});

const denied = await governance.evaluate({
  agentId: 'demo-agent',
  tool: 'file_write',
  params: { path: '/etc/passwd', content: 'hacked' },
});

// 4. Print results
console.log('--- search_web ---');
console.log(`  Allowed: ${allowed.allowed}`);
console.log(`  Trace:   ${allowed.traceId}`);

console.log('--- file_write /etc/passwd ---');
console.log(`  Allowed: ${denied.allowed}`);
console.log(`  Reason:  ${denied.reason}`);
console.log(`  Trace:   ${denied.traceId}`);
