/**
 * @agentbouncr/cli — Database Helper
 *
 * Creates and initializes a SqliteDatabaseAdapter with auto-migration.
 */

import pino from 'pino';
import { join } from 'node:path';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';

export async function createAdapter(
  dbPath: string = './governance.db',
  logger?: pino.Logger,
): Promise<SqliteDatabaseAdapter> {
  const log = logger ?? pino({ level: 'warn' });
  const migrationsDir = join(process.cwd(), 'migrations');
  const adapter = new SqliteDatabaseAdapter(log, dbPath, migrationsDir);
  await adapter.runMigrations();
  return adapter;
}
