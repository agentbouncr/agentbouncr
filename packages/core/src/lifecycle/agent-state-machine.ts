/**
 * @agentbouncr/core — Agent State Machine (AD-P5-19)
 *
 * 7 states, 18 valid transitions. ReadonlyMap for immutability.
 * assertTransition() throws GovernanceError on invalid transitions.
 * computeEffectiveStatus() implements lazy idle detection (AD-P5-06).
 */

import type { AgentRunStatus, AgentStatus } from '../types/index.js';
import { GovernanceError } from '../types/index.js';

// --- Transition Map (18 transitions) ---

export const AGENT_TRANSITIONS: ReadonlyMap<AgentRunStatus, ReadonlySet<AgentRunStatus>> = new Map([
  ['registered',     new Set<AgentRunStatus>(['active', 'decommissioned'])],
  ['active',         new Set<AgentRunStatus>(['idle', 'suspended', 'stopped', 'error'])],
  ['idle',           new Set<AgentRunStatus>(['active', 'suspended', 'stopped', 'decommissioned'])],
  ['suspended',      new Set<AgentRunStatus>(['active', 'stopped', 'decommissioned'])],
  ['stopped',        new Set<AgentRunStatus>(['active', 'decommissioned'])],
  ['error',          new Set<AgentRunStatus>(['active', 'stopped', 'decommissioned'])],
  ['decommissioned', new Set<AgentRunStatus>()],
]);

/**
 * Validate a state transition. Throws GovernanceError if invalid.
 */
export function assertTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  const allowed = AGENT_TRANSITIONS.get(from);
  if (!allowed?.has(to)) {
    throw new GovernanceError(
      `Invalid agent transition: ${from} → ${to}`,
      'INVALID_TRANSITION',
      'config_error',
    );
  }
}

// --- Lazy Idle Detection (AD-P5-06, AD-P5-13) ---

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Compute the effective status of an agent based on lastActiveAt.
 * Pure function — no side effects, no DB writes.
 *
 * - active + lastActiveAt > idleTimeout → idle
 * - idle + lastActiveAt <= idleTimeout → active
 * - all other states pass through unchanged
 */
export function computeEffectiveStatus(
  agent: AgentStatus,
  now: Date = new Date(),
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
): AgentRunStatus {
  if (agent.status === 'active' && agent.lastActiveAt) {
    const elapsed = now.getTime() - new Date(agent.lastActiveAt).getTime();
    if (elapsed > idleTimeoutMs) return 'idle';
  }
  if (agent.status === 'idle' && agent.lastActiveAt) {
    const elapsed = now.getTime() - new Date(agent.lastActiveAt).getTime();
    if (elapsed <= idleTimeoutMs) return 'active';
  }
  return agent.status;
}
