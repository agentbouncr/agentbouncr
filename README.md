# AgentBouncr — Agent Governance Framework

> **The source-available governance layer for AI agents.** Not the agent decides what it can do — the system decides.

Every AI agent tool call is checked against configurable policies before execution. Every decision is logged in a tamper-proof audit trail. Works with any agent framework (LangChain, Vercel AI SDK, OpenAI Agents SDK, CrewAI, n8n) via adapters.

## Features

- **Policy Engine** — JSON policies with 11 condition operators, deny-before-allow (fail-secure)
- **Audit Trail** — Append-only with SHA-256 hash-chain, verifiable integrity
- **Kill-Switch** — Instant emergency stop, no LLM involvement
- **Event System** — 20 event types with async dispatch
- **MCP Import** — Import tools from Model Context Protocol manifests
- **Vercel AI SDK Adapter** — Wrap any AI SDK tool with governance checks
- **W3C Trace Context** — OpenTelemetry-compatible trace IDs
- **Injection Detection** — Pattern-based detection (log + alert, no auto-block)
- **CLI** — Agent management, audit verification, MCP import
- **Zero-Config** — Works without any configuration (default: allow-all, log everything)

## Quick Start

```bash
npm install @agentbouncr/core
```

```typescript
import { GovernanceMiddleware } from '@agentbouncr/core';

const governance = new GovernanceMiddleware();

// Define a policy
governance.setPolicy({
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
});

// Check a tool call
const result = await governance.evaluate({
  agentId: 'my-agent',
  tool: 'file_write',
  params: { path: '/etc/passwd' },
});

console.log(result.allowed); // false
console.log(result.reason);  // "Writing to /etc/ is not permitted"
```

## Architecture

```
┌─────────────────────────────────────────────┐
│              Your AI Agent                   │
│  (LangChain, Vercel AI SDK, OpenAI, etc.)   │
└─────────────────┬───────────────────────────┘
                  │ evaluate()
┌─────────────────▼───────────────────────────┐
│         @agentbouncr/core                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │  Policy   │ │  Event   │ │ Kill-Switch  │ │
│  │  Engine   │ │  System  │ │              │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Injection│ │  Audit   │ │    Trace     │ │
│  │ Detection│ │  Trail   │ │   Context    │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
└─────────────────┬───────────────────────────┘
                  │ DatabaseAdapter
┌─────────────────▼───────────────────────────┐
│           @agentbouncr/sqlite                │
└─────────────────────────────────────────────┘
```

## Packages

| Package | Description | License |
|---|---|---|
| `@agentbouncr/core` | Policy Engine, Audit Trail, Events, Kill-Switch | ELv2 |
| `@agentbouncr/sqlite` | SQLite DatabaseAdapter (better-sqlite3) | ELv2 |
| `@agentbouncr/cli` | CLI for agent management and audit verification | ELv2 |

## Policy Example

Policies are plain JSON, validated with Zod:

```json
{
  "name": "restrict-payments",
  "version": "1.0",
  "rules": [
    {
      "tool": "approve_payment",
      "effect": "deny",
      "condition": { "amount": { "gt": 5000 } },
      "reason": "Payments over 5000 require manual approval"
    },
    {
      "tool": "file_write",
      "effect": "deny",
      "condition": { "path": { "startsWith": "/etc/" } },
      "reason": "System files are read-only"
    },
    { "tool": "*", "effect": "allow" }
  ]
}
```

**Condition operators:** `equals`, `notEquals`, `startsWith`, `endsWith`, `contains`, `gt`, `lt`, `gte`, `lte`, `in`, `matches`

## CLI

```bash
npm install -g @agentbouncr/cli

# Agent management
governance agent create --config ./agent.yaml
governance agent start claims-agent
governance agent list
governance agent stop claims-agent

# Audit trail
governance audit verify

# MCP import
governance import --mcp ./mcp-manifest.json
```

## With SQLite Persistence

```bash
npm install @agentbouncr/core @agentbouncr/sqlite
```

```typescript
import { GovernanceMiddleware } from '@agentbouncr/core';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import pino from 'pino';

const logger = pino({ level: 'info' });
const db = new SqliteDatabaseAdapter(logger, './governance.db');
await db.runMigrations();

const governance = new GovernanceMiddleware({ db, logger });

// Register and start an agent
await governance.registerAgent({
  agentId: 'claims-agent',
  name: 'Claims Processor',
  allowedTools: ['search_claims', 'approve_payment'],
});
await governance.startAgent('claims-agent');
```

## Examples

- [**quickstart.ts**](examples/quickstart.ts) — Zero-config, two tool calls (allowed + denied)
- [**claims-processor.ts**](examples/claims-processor.ts) — SQLite, conditions, events, kill-switch
- [**mcp-integration.ts**](examples/mcp-integration.ts) — MCP import with auto-risk-detection

## Documentation

- [Getting Started](docs/getting-started.md) — Step-by-step guide (<5 minutes)
- [API Reference](docs/api-reference.md) — Complete API documentation
- [MCP Import Guide](docs/mcp-import-guide.md) — Importing tools from MCP manifests

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

## License

Elastic License 2.0 (ELv2) — see [LICENSE](LICENSE)
