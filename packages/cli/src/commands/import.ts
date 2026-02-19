/**
 * @agentbouncr/cli — Import Commands
 *
 * governance import --mcp <file>
 */

import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { importMCPTools } from '@agentbouncr/core';
import type { MCPToolDefinition } from '@agentbouncr/core';

export function registerImportCommands(program: Command): void {
  program
    .command('import')
    .description('Import tools from external tool definitions')
    .requiredOption('--mcp <path>', 'Path to MCP manifest JSON file')
    .action(async (opts: { mcp: string }) => {
      try {
        const raw = readFileSync(opts.mcp, 'utf-8');
        const manifest = JSON.parse(raw) as unknown;

        // MCP manifest can be an array of tools directly, or { tools: [...] }
        let toolList: MCPToolDefinition[];
        if (Array.isArray(manifest)) {
          toolList = manifest as MCPToolDefinition[];
        } else if (
          manifest && typeof manifest === 'object' &&
          'tools' in manifest && Array.isArray((manifest as Record<string, unknown>).tools)
        ) {
          toolList = (manifest as { tools: MCPToolDefinition[] }).tools;
        } else {
          process.stderr.write('Error: Invalid MCP manifest format. Expected an array or { tools: [...] }.\n');
          process.exitCode = 1;
          return;
        }

        const tools = importMCPTools(toolList);

        if (tools.length === 0) {
          process.stdout.write('No tools found in manifest.\n');
          return;
        }

        process.stdout.write(`${tools.length} tool(s) imported:\n\n`);

        for (const tool of tools) {
          const params = tool.parameters.length > 0
            ? tool.parameters.map((p) => `${p.name}${p.required ? '*' : ''}`).join(', ')
            : 'none';
          process.stdout.write(
            `  ${tool.name} [${tool.riskLevel}] — ${tool.description ?? 'No description'}\n` +
            `    Parameters: ${params}\n`,
          );
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });
}
