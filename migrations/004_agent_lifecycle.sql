-- Migration 004: Agent Lifecycle — 7 states (Phase 5.2)
-- BREAKING: 'running' renamed to 'active'
-- New states: idle, suspended, decommissioned
-- SQLite: Table Recreation pattern (no ALTER CONSTRAINT)

INSERT INTO schema_version (version) VALUES (4);

-- 1. Rename existing 'running' → 'active'
UPDATE agents SET status = 'active' WHERE status = 'running';

-- 2. Recreate table with new CHECK constraint
CREATE TABLE agents_new (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  allowed_tools TEXT NOT NULL,
  policy_name TEXT,
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK(status IN ('registered', 'active', 'idle', 'suspended', 'stopped', 'error', 'decommissioned')),
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT
);

INSERT INTO agents_new SELECT * FROM agents;
DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;
