/**
 * @agentbouncr/sqlite — Migration Runner
 *
 * Reads SQL migration files from the migrations/ directory
 * and applies them in order. Tracks applied versions in schema_version table.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type pino from 'pino';

/**
 * Run all pending migrations against the given database.
 * Migrations are SQL files named NNN_description.sql in the migrationsDir.
 */
export function runMigrations(
  db: Database.Database,
  logger: pino.Logger,
  migrationsDir: string,
): void {
  // Ensure schema_version table exists (bootstrap)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentVersion = getCurrentVersion(db);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    logger.info({ migration: file, version }, 'Applying migration');

    db.exec(sql);
  }
}

function getCurrentVersion(db: Database.Database): number {
  const row = db.prepare(
    'SELECT MAX(version) as version FROM schema_version',
  ).get() as { version: number | null } | undefined;

  return row?.version ?? 0;
}
