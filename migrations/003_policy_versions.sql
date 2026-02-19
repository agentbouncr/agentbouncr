-- Migration 003: Policy Versioning (US-207)
-- Stores historical policy snapshots for version history + rollback.
-- Full snapshots (not diffs) — simpler, more reliable, policies are small.

INSERT INTO schema_version (version) VALUES (3);

CREATE TABLE IF NOT EXISTS policy_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_name TEXT NOT NULL,
  version TEXT NOT NULL,
  agent_id TEXT,
  rules TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'api',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (policy_name) REFERENCES policies(name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_policy_versions_name ON policy_versions(policy_name);
CREATE INDEX IF NOT EXISTS idx_policy_versions_created ON policy_versions(policy_name, created_at DESC);
