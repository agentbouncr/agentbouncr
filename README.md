# AgentBouncr

[![npm version](https://img.shields.io/npm/v/@agentbouncr/core.svg)](https://www.npmjs.com/package/@agentbouncr/core)
[![CI](https://github.com/agentbouncr/agentbouncr/actions/workflows/ci.yml/badge.svg)](https://github.com/agentbouncr/agentbouncr/actions/workflows/ci.yml)
[![License: ELv2](https://img.shields.io/badge/License-ELv2-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)

A governance layer that sits between AI agents and their tools. Policy engine, audit trail, kill switch.

---

## Quick Start

```bash
npm install @agentbouncr/core
```

```typescript
import { GovernanceMiddleware } from '@agentbouncr/core';

const governance = new GovernanceMiddleware();

governance.setPolicy({
  name: 'production',
  version: '1.0',
  rules: [
    { tool: 'approve_payment', effect: 'deny', condition: { amount: { gt: 5000 } }, reason: 'Payments over 5000 require manual approval' },
    { tool: 'file_write', effect: 'deny', condition: { path: { startsWith: '/etc/' } } },
    { tool: '*', effect: 'allow' },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const result = await governance.evaluate({
  agentId: 'claims-agent',
  tool: 'approve_payment',
  params: { amount: 12000, claimId: 'CLM-4821' },
});

console.log(result.allowed);  // false
console.log(result.reason);   // "Payments over 5000 require manual approval"
console.log(result.traceId);  // "00-a1b2c3..."  (W3C Trace Context)
```

Works with any agent framework — LangChain, Vercel AI SDK, OpenAI Agents SDK, CrewAI, n8n.

## Features

**Permission Layer** — Per-agent tool allowlists. Register agents with explicit tool sets, enforce at runtime.

**Policy Engine** — Declarative JSON rules with 11 condition operators (`equals`, `gt`, `startsWith`, `matches`, ...), rate limits, and human-in-the-loop approval gates. Deny-before-allow, fail-secure.

**Audit Trail** — Append-only log with SHA-256 hash chain. Every decision is recorded with trace ID, duration, and failure category. Tamper-evident, verifiable, exportable.

**Kill Switch** — Deterministic emergency stop. All tool calls are blocked synchronously in the evaluate path, no LLM involvement. Sub-millisecond activation.

**Injection Detection** — Configurable pattern matching for prompt injection attempts. Detects and logs without blocking (defense-in-depth, not a firewall).

**Event System** — 20 event types with async fire-and-forget dispatch. Subscribe to `tool_call.denied`, `killswitch.activated`, `agent.stopped`, etc. Built-in webhook support in Enterprise.

**W3C Trace Context** — OpenTelemetry-compatible 128-bit trace IDs propagated through every governance decision.

## Architecture

```
Your AI Agent (LangChain, Vercel AI SDK, OpenAI, CrewAI, ...)
         │
         │  evaluate({ agentId, tool, params })
         ▼
┌─────────────────────────────────────────────┐
│            @agentbouncr/core                │
│                                             │
│  ┌────────────┐  ┌────────────┐  ┌───────┐ │
│  │   Policy   │  │   Audit    │  │ Kill  │ │
│  │   Engine   │  │   Trail    │  │Switch │ │
│  └────────────┘  └────────────┘  └───────┘ │
│  ┌────────────┐  ┌────────────┐  ┌───────┐ │
│  │ Injection  │  │   Event    │  │ Trace │ │
│  │ Detection  │  │   System   │  │Context│ │
│  └────────────┘  └────────────┘  └───────┘ │
└──────────────────────┬──────────────────────┘
                       │
         ┌─────────────┴──────────────┐
         ▼                            ▼
  @agentbouncr/sqlite          @agentbouncr/postgres
  (dev / single-node)          (production, Enterprise)
```

## Packages

| Package | npm | Description |
|---|---|---|
| [`@agentbouncr/core`](packages/core) | [![npm](https://img.shields.io/npm/v/@agentbouncr/core.svg)](https://www.npmjs.com/package/@agentbouncr/core) | Policy engine, audit trail, events, kill switch |
| [`@agentbouncr/sqlite`](packages/sqlite) | [![npm](https://img.shields.io/npm/v/@agentbouncr/sqlite.svg)](https://www.npmjs.com/package/@agentbouncr/sqlite) | SQLite storage adapter (better-sqlite3) |
| [`@agentbouncr/cli`](packages/cli) | [![npm](https://img.shields.io/npm/v/@agentbouncr/cli.svg)](https://www.npmjs.com/package/@agentbouncr/cli) | CLI for agent management and audit verification |

## With Persistence

```bash
npm install @agentbouncr/core @agentbouncr/sqlite
```

```typescript
import { GovernanceMiddleware } from '@agentbouncr/core';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import pino from 'pino';

const db = new SqliteDatabaseAdapter(pino({ level: 'info' }), './governance.db');
await db.runMigrations();

const governance = new GovernanceMiddleware({ db });

// Register an agent with an explicit tool allowlist
await governance.registerAgent({
  agentId: 'claims-agent',
  name: 'Claims Processor',
  allowedTools: ['search_claims', 'approve_payment', 'send_email'],
});

// Audit trail is now persisted — verify integrity anytime
const verification = await db.verifyAuditChain();
console.log(verification.valid); // true
```

## Vercel AI SDK Integration

```typescript
import { wrapToolsWithGovernance, GovernanceMiddleware } from '@agentbouncr/core';

const governance = new GovernanceMiddleware();
governance.setPolicy(myPolicy);

// Wraps each tool's execute() with a governance check
const governedTools = wrapToolsWithGovernance(myTools, {
  agentId: 'my-agent',
  governance,
});
// Denied tools throw GovernanceError instead of executing
```

## Policy Reference

Policies are declarative JSON, validated with Zod at runtime:

```json
{
  "name": "restrict-payments",
  "version": "1.0",
  "rules": [
    {
      "tool": "approve_payment",
      "effect": "deny",
      "condition": { "amount": { "gt": 5000 } },
      "reason": "Payments over 5000 require manual approval",
      "requireApproval": true
    },
    {
      "tool": "send_email",
      "effect": "allow",
      "rateLimit": { "maxPerMinute": 10 }
    },
    { "tool": "*", "effect": "allow" }
  ]
}
```

**Condition operators:** `equals` `notEquals` `startsWith` `endsWith` `contains` `gt` `lt` `gte` `lte` `in` `matches`

## CLI

```bash
npm install -g @agentbouncr/cli

governance agent list
governance agent start claims-agent
governance audit verify
governance import --mcp ./mcp-manifest.json
```

## EU AI Act

AgentBouncr addresses key requirements of the EU AI Act for high-risk AI systems (effective August 2026). The policy engine maps to Art. 9 (risk management), the append-only audit trail with hash-chain verification satisfies Art. 12 (record-keeping), and approval workflows provide Art. 14 (human oversight) capabilities.

## Enterprise

Looking for multi-tenant PostgreSQL, SSO via Clerk, RBAC, a management dashboard, webhook integrations, and compliance reporting? See [agentbouncr.com](https://agentbouncr.com).

## Examples

- [**quickstart.ts**](examples/quickstart.ts) — Zero-config, policy evaluation in 10 lines
- [**claims-processor.ts**](examples/claims-processor.ts) — SQLite persistence, events, kill-switch
- [**mcp-integration.ts**](examples/mcp-integration.ts) — MCP import with auto-risk-detection

## Documentation

- [Getting Started](docs/getting-started.md) — Up and running in 5 minutes
- [API Reference](docs/api-reference.md) — Complete API documentation
- [MCP Import Guide](docs/mcp-import-guide.md) — Importing tools from MCP manifests

## License

[Elastic License 2.0 (ELv2)](LICENSE) — free to use, modify, and distribute. Cannot be offered as a competing managed service.
