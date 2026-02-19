/**
 * @agentbouncr/cli — Stop Command (Kill-Switch)
 *
 * governance stop --all
 */

import type { Command } from 'commander';
import { GovernanceMiddleware } from '@agentbouncr/core';
import { createAdapter } from '../utils/db.js';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Emergency stop — set all agents to stopped')
    .requiredOption('--all', 'Stop all agents')
    .option('--db <path>', 'Database path', './governance.db')
    .action(async (opts: { all: boolean; db: string }) => {
      try {
        if (!opts.all) return;

        const db = await createAdapter(opts.db);
        const mw = new GovernanceMiddleware({ db });
        const agents = await mw.listAgents();

        let stopped = 0;
        for (const agent of agents) {
          if (agent.status === 'running' || agent.status === 'registered') {
            await mw.stopAgent(agent.agentId, 'Emergency stop via CLI');
            stopped++;
          }
        }

        await db.close();

        process.stdout.write(
          `Emergency stop: ${stopped} agent(s) stopped (${agents.length} total).\n`,
        );
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });
}
