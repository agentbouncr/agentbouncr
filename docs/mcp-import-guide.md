# MCP Import Guide

Import tools from Model Context Protocol (MCP) manifests into the Agent Governance Framework.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) is an emerging standard for defining tools that AI agents can use. MCP servers expose a `tools/list` endpoint that returns tool definitions with names, descriptions, and JSON Schema input definitions.

The Governance Framework can import these tool definitions and apply governance policies to them.

## MCP Manifest Format

An MCP manifest is the response from a `tools/list` request — an array of tool definitions:

```json
[
  {
    "name": "read_file",
    "description": "Read contents of a file",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "File path to read" }
      },
      "required": ["path"]
    }
  },
  {
    "name": "write_file",
    "description": "Write contents to a file",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "File path" },
        "content": { "type": "string", "description": "Content to write" }
      },
      "required": ["path", "content"]
    }
  }
]
```

### Required Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Tool name (non-empty) |
| `description` | `string` | No | Human-readable description |
| `inputSchema` | `object` | No | JSON Schema for input parameters |

Tools with missing or empty `name` are skipped with a warning.

## CLI Usage

```bash
# Import tools from a manifest file
governance import --mcp ./mcp-manifest.json
```

The CLI reads the JSON file, imports the tools, and displays a preview:

```
Imported 3 tools from MCP manifest:

  read_file
    Risk Level: medium
    Parameters: path

  write_file
    Risk Level: medium
    Parameters: path, content

  execute_command
    Risk Level: medium
    Parameters: command, timeout
```

## Programmatic API

### Basic Import

```typescript
import { importMCPTools } from '@agentbouncr/core';
import type { MCPToolDefinition } from '@agentbouncr/core';

const mcpTools: MCPToolDefinition[] = [
  {
    name: 'search_database',
    description: 'Search the customer database',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
];

const tools = importMCPTools(mcpTools);
// Returns GovernanceTool[] with source: 'mcp'
```

### Custom Risk Level

```typescript
const tools = importMCPTools(mcpTools, {
  defaultRiskLevel: 'high',
});
```

Available risk levels: `'critical'`, `'high'`, `'medium'`, `'low'`

### With Logger

```typescript
import pino from 'pino';

const tools = importMCPTools(mcpTools, {
  logger: pino({ level: 'info' }),
});
```

The logger will warn about skipped tools (invalid name, non-object entries).

## JSON Schema Conversion

MCP tool input schemas (JSON Schema) are automatically converted to `GovernanceToolParameter[]`.

```typescript
import { jsonSchemaToParameters } from '@agentbouncr/core';

const params = jsonSchemaToParameters({
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path' },
    mode: {
      type: 'string',
      enum: ['read', 'write', 'append'],
      description: 'File open mode',
    },
    maxSize: {
      type: 'number',
      minimum: 0,
      maximum: 10485760,
      description: 'Max file size in bytes',
    },
  },
  required: ['path'],
});
```

### Supported JSON Schema Features

| JSON Schema | GovernanceToolParameter |
|---|---|
| `type: 'string'` | `type: 'string'` |
| `type: 'number'` / `'integer'` | `type: 'number'` |
| `type: 'boolean'` | `type: 'boolean'` |
| `type: 'object'` | `type: 'object'` with `children` |
| `type: 'array'` | `type: 'array'` |
| `description` | `description` |
| `default` | `default` |
| `enum` | `constraints.enum` |
| `minimum` | `constraints.min` |
| `maximum` | `constraints.max` |
| `maxLength` | `constraints.maxLength` |
| `pattern` | `constraints.pattern` |
| `required` (parent) | `required: true` on matching parameters |

## Applying Policies to MCP Tools

After importing, create policies that reference the MCP tool names:

```typescript
import { GovernanceMiddleware, importMCPTools } from '@agentbouncr/core';
import type { Policy, MCPToolDefinition } from '@agentbouncr/core';

// Import tools
const mcpTools: MCPToolDefinition[] = [/* ... */];
const tools = importMCPTools(mcpTools);

// Create governance with policies for imported tools
const governance = new GovernanceMiddleware();

const policy: Policy = {
  name: 'mcp-policy',
  version: '1.0',
  rules: [
    {
      tool: 'execute_command',
      effect: 'deny',
      reason: 'Shell execution is prohibited',
    },
    {
      tool: 'write_file',
      effect: 'deny',
      condition: { path: { startsWith: '/etc/' } },
      reason: 'Cannot write to system directories',
    },
    { tool: '*', effect: 'allow' },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

governance.setPolicy(policy);

// Evaluate tool calls using the imported tool names
const result = await governance.evaluate({
  agentId: 'mcp-agent',
  tool: 'write_file',
  params: { path: '/etc/hosts', content: '...' },
});
console.log(result.allowed); // false
```

## Complete Example

See [examples/mcp-integration.ts](../examples/mcp-integration.ts) for a full runnable example.
