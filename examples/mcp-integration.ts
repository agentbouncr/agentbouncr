/**
 * MCP Integration Example — Agent Governance Framework
 *
 * Demonstrates: Importing tools from an MCP manifest, auto-risk-level
 * assignment, and applying governance policies to MCP tools.
 *
 * Run: npx tsx examples/mcp-integration.ts
 */

import pino from 'pino';
import { GovernanceMiddleware, importMCPTools } from '@agentbouncr/core';
import type { Policy, MCPToolDefinition } from '@agentbouncr/core';

const logger = pino({ level: 'silent' });

// 1. Sample MCP manifest (tools/list response)
const mcpTools: MCPToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read contents of a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write contents to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms' },
      },
      required: ['command'],
    },
  },
];

// 2. Import MCP tools into Governance format
const tools = importMCPTools(mcpTools, { defaultRiskLevel: 'high', logger });

console.log('=== Imported MCP Tools ===\n');
for (const tool of tools) {
  console.log(`  ${tool.name}`);
  console.log(`    Source:     ${tool.source}`);
  console.log(`    Risk:       ${tool.riskLevel}`);
  console.log(`    Parameters: ${tool.parameters.map((p) => p.name).join(', ')}`);
}

// 3. Create governance with a policy for MCP tools
const governance = new GovernanceMiddleware({ logger });

const policy: Policy = {
  name: 'mcp-security',
  version: '1.0',
  rules: [
    {
      name: 'block-execute',
      tool: 'execute_command',
      effect: 'deny',
      reason: 'Shell execution is not permitted',
    },
    {
      name: 'block-etc-write',
      tool: 'write_file',
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

// 4. Evaluate MCP tool calls
console.log('\n=== Policy Evaluation ===\n');

const r1 = await governance.evaluate({
  agentId: 'mcp-agent',
  tool: 'read_file',
  params: { path: '/home/user/report.csv' },
});
console.log(`  read_file /home/...:    ${r1.allowed ? 'ALLOWED' : 'DENIED'}`);

const r2 = await governance.evaluate({
  agentId: 'mcp-agent',
  tool: 'write_file',
  params: { path: '/etc/hosts', content: '127.0.0.1 evil.com' },
});
console.log(`  write_file /etc/hosts:  ${r2.allowed ? 'ALLOWED' : `DENIED — ${r2.reason}`}`);

const r3 = await governance.evaluate({
  agentId: 'mcp-agent',
  tool: 'execute_command',
  params: { command: 'rm -rf /' },
});
console.log(`  execute_command:        ${r3.allowed ? 'ALLOWED' : `DENIED — ${r3.reason}`}`);

const r4 = await governance.evaluate({
  agentId: 'mcp-agent',
  tool: 'write_file',
  params: { path: '/tmp/output.txt', content: 'safe' },
});
console.log(`  write_file /tmp/...:    ${r4.allowed ? 'ALLOWED' : 'DENIED'}`);
