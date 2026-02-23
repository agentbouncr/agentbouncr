# Changelog

## 0.2.1

### Security Hardening

- **Input validation**: Added `max()` constraints to all Zod schema string fields to prevent abuse via oversized payloads (DSGVO Art. 25 — data minimization)
  - `evaluateRequestSchema`: `agentId` max 128, `tool` max 256, `traceId` max 256
  - `dryRunRequestSchema`: same limits as evaluate
  - `agentConfigSchema`: `agentId` max 128, `name` max 256, `description` max 2000, `policyName` max 128, `allowedTools` entries max 256

## 0.2.0

### Breaking Changes

- **`AgentRunStatus`**: `'running'` renamed to `'active'`. Update all status checks.
- **New states**: `'idle'`, `'suspended'`, `'decommissioned'` added to `AgentRunStatus`.
- **State Machine**: `transitionAgent()` validates transitions. Invalid transitions throw `GovernanceError` with code `INVALID_TRANSITION`.
- **`emergencyStop()` / `resetKillSwitch()`**: Now `async` (return `Promise<void>` instead of `void`). They suspend/reactivate agents in the database.
- **SQLite Migration 004**: `agents` table recreated with new CHECK constraint. Existing `'running'` rows auto-migrated to `'active'`.

### New Features

- Agent State Machine: 7 states, 18 validated transitions (`AGENT_TRANSITIONS` ReadonlyMap)
- Lazy Idle Detection: `computeEffectiveStatus()` — agents idle >30min auto-detected on read
- Kill-Switch Integration: `emergencyStop()` suspends active/idle agents, `resetKillSwitch()` reactivates only kill-switch-suspended agents
- New events: `agent.suspended`, `agent.idle`, `agent.decommissioned`
- SQLite timestamp normalization: `datetime('now')` results now properly formatted as ISO 8601 with UTC marker

### Migration Guide

1. Replace `'running'` with `'active'` in all status checks
2. `startAgent()` now transitions to `'active'` (was `'running'`)
3. Add `await` to `emergencyStop()` and `resetKillSwitch()` calls
4. If using SQLite: Migration 004 runs automatically via `runMigrations()`
5. If using PostgreSQL: Run superuser migration first (see enterprise docs)

## 0.1.1

Initial public release. Policy Engine, Audit Trail, Kill-Switch, Event System, Tool Registry, Injection Detection, Vercel AI SDK adapter.
