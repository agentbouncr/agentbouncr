-- Migration 002: Tools Registry
-- Stores imported and manually created governance tools (AD-13)

INSERT INTO schema_version (version) VALUES (2);

CREATE TABLE IF NOT EXISTS tools (
  name TEXT PRIMARY KEY,
  description TEXT,
  parameters TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('critical', 'high', 'medium', 'low')),
  category TEXT,
  source TEXT NOT NULL CHECK(source IN ('manual', 'import', 'mcp')),
  version TEXT,
  tags TEXT,
  timeout INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tools_source ON tools(source);
CREATE INDEX IF NOT EXISTS idx_tools_risk_level ON tools(risk_level);
