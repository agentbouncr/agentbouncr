/**
 * @agentbouncr/cli — Audit Commands
 *
 * governance audit verify
 */

import type { Command } from 'commander';
import { createAdapter } from '../utils/db.js';

export function registerAuditCommands(program: Command): void {
  const audit = program
    .command('audit')
    .description('Audit trail operations');

  audit
    .command('verify')
    .description('Verify the integrity of the audit trail hash-chain')
    .option('--db <path>', 'Database path', './governance.db')
    .action(async (opts: { db: string }) => {
      try {
        const db = await createAdapter(opts.db);
        const result = await db.verifyAuditChain();
        await db.close();

        if (result.valid) {
          process.stdout.write(
            `Audit trail valid. ${result.totalEvents} events verified.\n`,
          );
        } else {
          process.stderr.write(
            `Audit trail INVALID! Chain broken at event #${result.brokenAt}. ` +
            `${result.verifiedEvents}/${result.totalEvents} events verified.\n`,
          );
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });
}
