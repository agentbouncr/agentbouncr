-- Migration 001: Initial Schema
-- Tables: schema_version, audit_events, policies, agents

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO schema_version (version) VALUES (1);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  params TEXT,
  result TEXT NOT NULL CHECK(result IN ('allowed', 'denied', 'error')),
  reason TEXT,
  duration_ms INTEGER NOT NULL,
  failure_category TEXT,
  previous_hash TEXT,
  hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_trace_id ON audit_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_agent_id ON audit_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);

-- Append-Only: Triggers prevent UPDATE/DELETE (AD-05)
CREATE TRIGGER IF NOT EXISTS audit_no_update
  BEFORE UPDATE ON audit_events
  BEGIN
    SELECT RAISE(ABORT, 'audit_events is append-only: UPDATE not allowed');
  END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete
  BEFORE DELETE ON audit_events
  BEGIN
    SELECT RAISE(ABORT, 'audit_events is append-only: DELETE not allowed');
  END;

CREATE TABLE IF NOT EXISTS policies (
  name TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  agent_id TEXT,
  rules TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  allowed_tools TEXT NOT NULL,
  policy_name TEXT,
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered', 'running', 'stopped', 'error')),
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT
);
