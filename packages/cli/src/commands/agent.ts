/**
 * @agentbouncr/cli — Agent Commands
 *
 * governance agent create --config <file>
 * governance agent start <id>
 * governance agent stop <id>
 * governance agent list
 * governance agent status <id>
 */

import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { GovernanceMiddleware } from '@agentbouncr/core';
import type { AgentConfig } from '@agentbouncr/core';
import { createAdapter } from '../utils/db.js';

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage governance agents');

  agent
    .command('create')
    .description('Register a new agent from a JSON config file')
    .requiredOption('--config <path>', 'Path to agent config JSON file')
    .option('--db <path>', 'Database path', './governance.db')
    .action(async (opts: { config: string; db: string }) => {
      try {
        const raw = readFileSync(opts.config, 'utf-8');
        const config = JSON.parse(raw) as unknown;

        const db = await createAdapter(opts.db);
        const mw = new GovernanceMiddleware({ db });
        const id = await mw.registerAgent(config as AgentConfig);
        await db.close();

        process.stdout.write(`Agent registered: ${id}\n`);
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });

  agent
    .command('start')
    .description('Start an agent (set status to running)')
    .argument('<agent-id>', 'Agent ID')
    .option('--db <path>', 'Database path', './governance.db')
    .action(async (agentId: string, opts: { db: string }) => {
      try {
        const db = await createAdapter(opts.db);
        const mw = new GovernanceMiddleware({ db });
        await mw.startAgent(agentId);
        await db.close();

        process.stdout.write(`Agent started: ${agentId}\n`);
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });

  agent
    .command('stop')
    .description('Stop an agent (set status to stopped)')
    .argument('<agent-id>', 'Agent ID')
    .option('--db <path>', 'Database path', './governance.db')
    .action(async (agentId: string, opts: { db: string }) => {
      try {
        const db = await createAdapter(opts.db);
        const mw = new GovernanceMiddleware({ db });
        await mw.stopAgent(agentId);
        await db.close();

        process.stdout.write(`Agent stopped: ${agentId}\n`);
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });

  agent
    .command('list')
    .description('List all registered agents')
    .option('--db <path>', 'Database path', './governance.db')
    .action(async (opts: { db: string }) => {
      try {
        const db = await createAdapter(opts.db);
        const mw = new GovernanceMiddleware({ db });
        const agents = await mw.listAgents();
        await db.close();

        if (agents.length === 0) {
          process.stdout.write('No agents registered.\n');
          return;
        }

        // Table header
        process.stdout.write(
          `${'ID'.padEnd(24)} ${'NAME'.padEnd(24)} ${'STATUS'.padEnd(12)} REGISTERED\n`,
        );
        process.stdout.write(`${'─'.repeat(24)} ${'─'.repeat(24)} ${'─'.repeat(12)} ${'─'.repeat(24)}\n`);

        for (const a of agents) {
          process.stdout.write(
            `${a.agentId.padEnd(24)} ${a.name.padEnd(24)} ${a.status.padEnd(12)} ${a.registeredAt}\n`,
          );
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });

  agent
    .command('status')
    .description('Show status of a specific agent')
    .argument('<agent-id>', 'Agent ID')
    .option('--db <path>', 'Database path', './governance.db')
    .action(async (agentId: string, opts: { db: string }) => {
      try {
        const db = await createAdapter(opts.db);
        const mw = new GovernanceMiddleware({ db });
        const status = await mw.getAgentStatus(agentId);
        await db.close();

        if (!status) {
          process.stderr.write(`Agent not found: ${agentId}\n`);
          process.exitCode = 1;
          return;
        }

        process.stdout.write(`Agent ID:     ${status.agentId}\n`);
        process.stdout.write(`Name:         ${status.name}\n`);
        process.stdout.write(`Status:       ${status.status}\n`);
        process.stdout.write(`Registered:   ${status.registeredAt}\n`);
        if (status.lastActiveAt) {
          process.stdout.write(`Last Active:  ${status.lastActiveAt}\n`);
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });
}
