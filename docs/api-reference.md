# API Reference

Complete API documentation for `@agentbouncr/core`, `@agentbouncr/sqlite`, and `@agentbouncr/cli`.

## Table of Contents

- [GovernanceMiddleware](#governancemiddleware)
- [PolicyEngine](#policyengine)
- [Policy Schema](#policy-schema)
- [DatabaseAdapter](#databaseadapter)
- [Event System](#event-system)
- [Audit Trail](#audit-trail)
- [Tool Schema](#tool-schema)
- [Injection Detection](#injection-detection)
- [MCP Import](#mcp-import)
- [Tracing](#tracing)
- [Error Handling](#error-handling)
- [Provider Adapter](#provider-adapter)
- [CLI](#cli)

---

## GovernanceMiddleware

Main entry point for developers. Orchestrates PolicyEngine, EventEmitter, KillSwitch, and DatabaseAdapter.

```typescript
import { GovernanceMiddleware } from '@agentbouncr/core';
```

### Constructor

```typescript
new GovernanceMiddleware(options?: GovernanceMiddlewareOptions)
```

| Option | Type | Description |
|---|---|---|
| `db` | `DatabaseAdapter` | Optional database adapter for persistence |
| `policy` | `Policy` | Optional inline policy |
| `logger` | `pino.Logger` | Optional logger (default: pino info level) |

### evaluate(request)

Evaluate a tool-call request against governance policies.

```typescript
async evaluate(request: EvaluateRequest): Promise<EvaluateResult>
```

**EvaluateRequest:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agentId` | `string` | Yes | Agent identifier |
| `tool` | `string` | Yes | Tool name |
| `params` | `Record<string, unknown>` | No | Tool parameters |
| `traceId` | `string` | No | Custom trace ID (auto-generated if omitted) |

**EvaluateResult:**

| Field | Type | Description |
|---|---|---|
| `allowed` | `boolean` | Whether the tool call is permitted |
| `traceId` | `string` | W3C Trace Context compatible trace ID |
| `reason` | `string \| undefined` | Reason for denial |
| `appliedRules` | `AppliedRule[]` | Rules that were applied |

**Evaluation flow:**
1. Input validation (Zod)
2. Kill-Switch check (immediate deny if active)
3. Policy resolution: inline > DB > default allow-all
4. PolicyEngine evaluation
5. Event emission (`tool_call.allowed` or `tool_call.denied`)

### setPolicy(policy)

Set an inline policy. Validated with Zod.

```typescript
setPolicy(policy: Policy): void
```

Throws `GovernanceError` with code `INVALID_POLICY` if validation fails.

### Agent Lifecycle (requires DatabaseAdapter)

```typescript
async registerAgent(config: AgentConfig): Promise<string>
async startAgent(agentId: string): Promise<void>
async stopAgent(agentId: string, reason?: string): Promise<void>
async getAgentStatus(agentId: string): Promise<AgentStatus | null>
async listAgents(): Promise<AgentStatus[]>
async deleteAgent(agentId: string): Promise<boolean>
```

**AgentConfig:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agentId` | `string` | Yes | Unique agent identifier |
| `name` | `string` | Yes | Human-readable name |
| `description` | `string` | No | Agent description |
| `allowedTools` | `string[]` | Yes | List of permitted tool names |
| `policyName` | `string` | No | Associated policy name |
| `metadata` | `Record<string, unknown>` | No | Custom metadata |

**AgentStatus:**

| Field | Type | Description |
|---|---|---|
| `agentId` | `string` | Agent identifier |
| `name` | `string` | Human-readable name |
| `status` | `AgentRunStatus` | `'registered' \| 'running' \| 'stopped' \| 'error'` |
| `registeredAt` | `string` | ISO 8601 timestamp |
| `lastActiveAt` | `string \| undefined` | Last activity timestamp |

Throws `GovernanceError` with code `DATABASE_REQUIRED` if no DatabaseAdapter was provided.

### Kill-Switch

```typescript
emergencyStop(reason?: string): void
resetKillSwitch(): void
isKillSwitchActive(): boolean
```

### Event Subscription

```typescript
on(type: GovernanceEventType, listener: GovernanceEventListener): void
off(type: GovernanceEventType, listener: GovernanceEventListener): void
```

---

## PolicyEngine

Evaluates tool-call requests against a policy's rules. Used internally by GovernanceMiddleware but can also be used standalone.

```typescript
import { PolicyEngine } from '@agentbouncr/core';
import pino from 'pino';

const engine = new PolicyEngine(pino({ level: 'info' }));
const result = engine.evaluate(request, policy);
```

### Rule Priority

1. **Tool + condition** (most specific) — `{ tool: 'file_write', condition: { path: { startsWith: '/etc/' } } }`
2. **Tool-only** — `{ tool: 'file_write', effect: 'deny' }`
3. **Wildcard** — `{ tool: '*', effect: 'allow' }`

At the same specificity level, `deny` takes precedence over `allow` (fail-secure).

---

## Policy Schema

Policies are plain JSON objects validated with Zod.

```typescript
import { policySchema, validatePolicy } from '@agentbouncr/core';
```

### Policy

```typescript
interface Policy {
  name: string;
  version: string;
  agentId?: string;
  rules: PolicyRule[];
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
}
```

### PolicyRule

```typescript
interface PolicyRule {
  name?: string;
  tool: string;           // Tool name or '*' for wildcard
  effect: 'allow' | 'deny';
  condition?: PolicyCondition;
  reason?: string;
  rateLimit?: { maxPerMinute: number };
  requireApproval?: boolean;  // Requires human approval before execution
}
```

### PolicyCondition

Maps parameter names to operator-value pairs. All conditions are AND-combined.

```typescript
type PolicyCondition = Record<string, Partial<Record<ConditionOperator, unknown>>>;
```

### Condition Operators

| Operator | Value Type | Behavior |
|---|---|---|
| `equals` | any | Strict equality (`===`) |
| `notEquals` | any | Strict inequality (`!==`) |
| `startsWith` | string | `paramValue.startsWith(operand)` |
| `endsWith` | string | `paramValue.endsWith(operand)` |
| `contains` | string | `paramValue.includes(operand)` |
| `gt` | number | `paramValue > operand` |
| `lt` | number | `paramValue < operand` |
| `gte` | number | `paramValue >= operand` |
| `lte` | number | `paramValue <= operand` |
| `in` | array | `operand.includes(paramValue)` |
| `matches` | string (regex) | `new RegExp(operand).test(paramValue)` |

**Security:** `matches` rejects patterns longer than 200 characters (ReDoS protection). Invalid regex patterns return `false` (fail-secure).

**Fail-secure behavior:** Missing parameters, type mismatches, and unknown operators all return `false`.

---

## DatabaseAdapter

Abstract interface for database operations. Implemented by `SqliteDatabaseAdapter`.

```typescript
import type { DatabaseAdapter } from '@agentbouncr/core';
```

### Interface (16 methods)

```typescript
interface DatabaseAdapter {
  // Audit Trail (5)
  writeAuditEvent(event: AuditEventInput): Promise<void>;
  queryAuditEvents(filter: AuditFilter): Promise<AuditEvent[]>;
  getLatestAuditHash(): Promise<string | null>;
  verifyAuditChain(): Promise<AuditChainVerificationResult>;
  exportAuditEvents(filter: AuditFilter, stream: NodeJS.WritableStream): Promise<void>;

  // Policy (2)
  writePolicy(policy: Policy): Promise<void>;
  getActivePolicy(agentId: string): Promise<Policy | null>;

  // Agent Lifecycle (5)
  registerAgent(config: AgentConfig): Promise<string>;
  getAgentStatus(agentId: string): Promise<AgentStatus | null>;
  updateAgentStatus(agentId: string, status: AgentRunStatus): Promise<void>;
  listAgents(): Promise<AgentStatus[]>;
  deleteAgent(agentId: string): Promise<boolean>;

  // Schema Management (2)
  runMigrations(): Promise<void>;
  getSchemaVersion(): Promise<number>;

  // Transaction (1)
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;

  // Lifecycle (1)
  close(): Promise<void>;
}
```

### SqliteDatabaseAdapter

```typescript
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import pino from 'pino';

const db = new SqliteDatabaseAdapter(
  pino({ level: 'info' }),  // logger
  './governance.db',         // path (or ':memory:' for testing)
  './migrations',            // migrations directory (optional)
);
await db.runMigrations();
```

### AuditFilter

```typescript
interface AuditFilter {
  agentId?: string;
  tool?: string;
  result?: 'allowed' | 'denied' | 'error';
  traceId?: string;
  fromTimestamp?: string;   // ISO 8601
  toTimestamp?: string;     // ISO 8601
  limit?: number;
  offset?: number;
}
```

---

## Event System

Async in-process event dispatch. Listeners never block the governance check.

```typescript
import { GovernanceEventEmitter } from '@agentbouncr/core';
import type { GovernanceEventType, GovernanceEvent, GovernanceEventListener } from '@agentbouncr/core';
```

### Event Types (20)

| Category | Events |
|---|---|
| Tool Call | `tool_call.allowed`, `tool_call.denied`, `tool_call.error` |
| Approval | `approval.requested`, `approval.granted`, `approval.rejected`, `approval.timeout` |
| Agent | `agent.started`, `agent.stopped`, `agent.error`, `agent.config_changed` |
| Security | `injection.detected`, `killswitch.activated`, `killswitch.deactivated`, `audit.integrity_violation`, `audit.write_failure` |
| Policy | `policy.created`, `policy.updated`, `policy.deleted` |
| System | `rate_limit.exceeded` |

### GovernanceEvent

```typescript
interface GovernanceEvent<T = Record<string, unknown>> {
  type: GovernanceEventType;
  timestamp: string;      // ISO 8601
  traceId?: string;
  agentId?: string;
  data: T;
}
```

### Listener Timeout

Each listener has a maximum execution time of 100ms. Listeners that exceed this timeout are logged as warnings but do not affect other listeners or the governance check.

---

## Audit Trail

Append-only audit trail with SHA-256 hash-chain for tamper detection.

```typescript
import { computeAuditHash, verifyAuditEventHash } from '@agentbouncr/core';
import type { AuditEvent, AuditEventInput, HashInput } from '@agentbouncr/core';
```

### AuditEvent

```typescript
interface AuditEvent {
  id?: number;
  traceId: string;
  timestamp: string;
  agentId: string;
  tool: string;
  params?: Record<string, unknown>;
  result: 'allowed' | 'denied' | 'error';
  reason?: string;
  durationMs: number;
  failureCategory?: FailureCategory;
  previousHash: string | null;
  hash: string;
}
```

### Hash-Chain

Each audit event contains the hash of the previous event, creating a tamper-proof chain.

```typescript
// Compute hash for a new event
const hash = computeAuditHash({
  traceId, timestamp, agentId, tool, params,
  result, reason, durationMs, failureCategory,
  previousHash,
});

// Verify an existing event's hash
const valid = verifyAuditEventHash(event);
```

### Chain Verification

```typescript
const result = await db.verifyAuditChain();
// { valid: boolean, brokenAt?: number, totalEvents: number, verifiedEvents: number }
```

---

## Tool Schema

Canonical tool definitions for governance.

```typescript
import type { GovernanceTool, GovernanceToolParameter, RiskLevel } from '@agentbouncr/core';
import { governanceToolSchema, riskLevelSchema } from '@agentbouncr/core';
```

### GovernanceTool

```typescript
interface GovernanceTool {
  name: string;
  description?: string;
  parameters: GovernanceToolParameter[];
  riskLevel: RiskLevel;        // 'critical' | 'high' | 'medium' | 'low'
  category?: string;
  source: ToolSource;          // 'manual' | 'import' | 'mcp'
  version?: string;
  tags?: string[];
  timeout?: number;
}
```

### GovernanceToolParameter

```typescript
interface GovernanceToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
  default?: unknown;
  children?: GovernanceToolParameter[];
  constraints?: ToolParameterConstraints;
}
```

### ToolParameterConstraints

```typescript
interface ToolParameterConstraints {
  enum?: (string | number)[];
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
  jsonSchema?: object;
}
```

---

## Injection Detection

Pattern-based prompt injection detection. Detects but never auto-blocks (false-positive risk).

```typescript
import { detectInjection, DEFAULT_INJECTION_PATTERNS } from '@agentbouncr/core';
import type { InjectionPattern, InjectionDetectionOptions } from '@agentbouncr/core';
```

### detectInjection(text, options?)

```typescript
function detectInjection(
  text: string,
  options?: InjectionDetectionOptions,
): InjectionDetectionResult
```

**InjectionDetectionResult:**

| Field | Type | Description |
|---|---|---|
| `detected` | `boolean` | Whether any pattern matched |
| `patterns` | `string[]` | Names of matched patterns |
| `text` | `string` | Original input text |

### Default Patterns

| Pattern Name | Detects |
|---|---|
| `ignore_previous_instructions` | "ignore previous instructions" variants |
| `system_prompt_override` | `` ```system `` code blocks |
| `admin_mode` | "admin mode", "developer mode", "debug mode" |
| `reveal_instructions` | "show system prompt", "reveal API key" |
| `role_hijack` | "you are now", "from now on you are" |
| `instruction_delimiter` | `[INST]`, `<\|im_start\|>`, `<system>` |
| `execute_command` | `exec()`, `eval()`, `child_process` |

### Options

```typescript
interface InjectionDetectionOptions {
  disabledPatterns?: string[];   // Pattern names to skip
  logger?: pino.Logger;          // Custom logger (default: securityLogger)
}
```

---

## MCP Import

Import tools from Model Context Protocol (MCP) manifests.

```typescript
import { importMCPTools } from '@agentbouncr/core';
import type { MCPToolDefinition, MCPImportOptions } from '@agentbouncr/core';
```

### importMCPTools(toolList, options?)

```typescript
function importMCPTools(
  toolList: MCPToolDefinition[],
  options?: MCPImportOptions,
): GovernanceTool[]
```

Converts MCP tool definitions to `GovernanceTool[]`. Invalid tools (missing/empty name) are skipped with a warning.

**MCPToolDefinition:**

```typescript
interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;  // JSON Schema
}
```

**MCPImportOptions:**

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultRiskLevel` | `RiskLevel` | `'medium'` | Default risk level for imported tools |
| `logger` | `pino.Logger` | none | Logger for skip-warnings |

### jsonSchemaToParameters(schema)

Converts JSON Schema to `GovernanceToolParameter[]`.

```typescript
import { jsonSchemaToParameters } from '@agentbouncr/core';

const params = jsonSchemaToParameters({
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path' },
    mode: { type: 'string', enum: ['read', 'write'] },
  },
  required: ['path'],
});
```

---

## Tracing

W3C Trace Context compatible trace ID generation and propagation.

```typescript
import {
  TraceProvider,
  createTraceContext,
  generateTraceId,
  generateSpanId,
  isValidTraceId,
  isValidSpanId,
  parseTraceparent,
} from '@agentbouncr/core';
import type { TraceContext } from '@agentbouncr/core';
```

### TraceProvider

Manages trace context propagation using `AsyncLocalStorage`.

```typescript
const provider = new TraceProvider();

// Run code within a trace context
await provider.runInContext(traceContext, async () => {
  const ctx = provider.getCurrentContext();
  console.log(ctx?.traceId);
});
```

### Trace ID Format

- **Trace ID:** 32 hex characters (128-bit), W3C compatible
- **Span ID:** 16 hex characters (64-bit)

```typescript
const traceId = generateTraceId(); // e.g., "4eca798e993bd8a72157244a65bd5902"
const spanId = generateSpanId();   // e.g., "a93a22d51869cb0f"
```

### parseTraceparent(header)

Parse a W3C `traceparent` header:

```typescript
const ctx = parseTraceparent('00-4eca798e993bd8a72157244a65bd5902-a93a22d51869cb0f-01');
// { version: '00', traceId: '...', spanId: '...', traceFlags: '01' }
```

---

## Error Handling

All framework errors use `GovernanceError`.

```typescript
import { GovernanceError } from '@agentbouncr/core';
import type { FailureCategory } from '@agentbouncr/core';
```

### GovernanceError

```typescript
class GovernanceError extends Error {
  readonly name = 'GovernanceError';
  readonly code: string;
  readonly category: FailureCategory;
  readonly context?: Record<string, unknown>;
}
```

### Error Codes

| Code | Where | Description |
|---|---|---|
| `INVALID_REQUEST` | `evaluate()` | EvaluateRequest failed Zod validation |
| `INVALID_CONFIG` | `registerAgent()` | AgentConfig failed Zod validation |
| `INVALID_POLICY` | `setPolicy()` | Policy failed Zod validation |
| `DATABASE_REQUIRED` | Agent CRUD methods | No DatabaseAdapter provided |
| `AGENT_NOT_FOUND` | `updateAgentStatus()` | Agent ID doesn't exist |
| `PERMISSION_DENIED` | PolicyEngine | Tool call denied by policy |

### Failure Categories

| Category | Description |
|---|---|
| `tool_error` | Tool execution failed |
| `policy_denial` | Denied by governance policy |
| `provider_timeout` | AI provider timeout |
| `provider_error` | AI provider error |
| `injection_alert` | Injection pattern detected |
| `config_error` | Configuration or validation error |
| `rate_limit` | Rate limit exceeded |
| `approval_timeout` | Approval workflow timeout |

---

## Provider Adapter

Wrap Vercel AI SDK tools with governance checks.

```typescript
import { wrapToolsWithGovernance } from '@agentbouncr/core';
import type { AITool, AIToolSet, GovernanceWrapOptions } from '@agentbouncr/core';
```

### wrapToolsWithGovernance(tools, options)

```typescript
function wrapToolsWithGovernance(
  tools: AIToolSet,
  options: GovernanceWrapOptions,
): AIToolSet
```

Wraps each tool's `execute` function with a governance check. If the check denies the call, the tool returns a denial message instead of executing.

**GovernanceWrapOptions:**

| Option | Type | Description |
|---|---|---|
| `agentId` | `string` | Agent identifier for governance checks |
| `governance` | `GovernanceMiddleware` | Middleware instance |
| `logger` | `pino.Logger` | Optional logger |

---

## CLI

Command-line interface for agent management and audit operations.

```bash
npm install -g @agentbouncr/cli
```

### Commands

| Command | Description |
|---|---|
| `governance agent create --config <file>` | Register an agent from YAML config |
| `governance agent start <id>` | Start an agent |
| `governance agent stop <id>` | Stop an agent |
| `governance agent list` | List all registered agents |
| `governance agent status <id>` | Show agent status |
| `governance audit verify` | Verify audit trail hash-chain integrity |
| `governance import --mcp <file>` | Import tools from MCP manifest |
| `governance stop --all` | Emergency stop all agents |

### Agent Config YAML

```yaml
agentId: claims-agent
name: Insurance Claims Processor
description: Processes insurance claims
allowedTools:
  - search_claims
  - approve_payment
  - file_read
policyName: claims-policy
metadata:
  environment: production
  team: claims
```

### Database Configuration

The CLI uses `./governance.db` by default. Set `GOVERNANCE_DB_PATH` environment variable to override:

```bash
GOVERNANCE_DB_PATH=/var/lib/governance/data.db governance agent list
```
