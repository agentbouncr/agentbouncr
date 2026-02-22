import { describe, it, expect } from 'vitest';
import {
  AGENT_TRANSITIONS,
  assertTransition,
  computeEffectiveStatus,
  GovernanceError,
} from '@agentbouncr/core';
import type { AgentRunStatus, AgentStatus } from '@agentbouncr/core';

function makeAgent(overrides?: Partial<AgentStatus>): AgentStatus {
  return {
    agentId: 'test-agent',
    name: 'Test',
    status: 'registered',
    registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Agent State Machine (AD-P5-19)', () => {
  describe('AGENT_TRANSITIONS', () => {
    it('should define exactly 7 states', () => {
      expect(AGENT_TRANSITIONS.size).toBe(7);
    });

    it('should contain all expected states', () => {
      const states: AgentRunStatus[] = [
        'registered', 'active', 'idle', 'suspended', 'stopped', 'error', 'decommissioned',
      ];
      for (const state of states) {
        expect(AGENT_TRANSITIONS.has(state)).toBe(true);
      }
    });

    it('should have exactly 18 total transitions', () => {
      let total = 0;
      for (const targets of AGENT_TRANSITIONS.values()) {
        total += targets.size;
      }
      expect(total).toBe(18);
    });

    it('should have no outgoing transitions from decommissioned (terminal state)', () => {
      const targets = AGENT_TRANSITIONS.get('decommissioned');
      expect(targets?.size).toBe(0);
    });

    it('should not include "running" as a state (Clean Break)', () => {
      expect(AGENT_TRANSITIONS.has('running' as AgentRunStatus)).toBe(false);
    });
  });

  describe('assertTransition() — valid transitions', () => {
    const validTransitions: [AgentRunStatus, AgentRunStatus][] = [
      // registered (2)
      ['registered', 'active'],
      ['registered', 'decommissioned'],
      // active (4)
      ['active', 'idle'],
      ['active', 'suspended'],
      ['active', 'stopped'],
      ['active', 'error'],
      // idle (4)
      ['idle', 'active'],
      ['idle', 'suspended'],
      ['idle', 'stopped'],
      ['idle', 'decommissioned'],
      // suspended (3)
      ['suspended', 'active'],
      ['suspended', 'stopped'],
      ['suspended', 'decommissioned'],
      // stopped (2)
      ['stopped', 'active'],
      ['stopped', 'decommissioned'],
      // error (3)
      ['error', 'active'],
      ['error', 'stopped'],
      ['error', 'decommissioned'],
    ];

    it.each(validTransitions)('%s → %s should be valid', (from, to) => {
      expect(() => assertTransition(from, to)).not.toThrow();
    });
  });

  describe('assertTransition() — invalid transitions', () => {
    const invalidTransitions: [AgentRunStatus, AgentRunStatus][] = [
      // registered cannot go to stopped, idle, suspended, error
      ['registered', 'stopped'],
      ['registered', 'idle'],
      ['registered', 'suspended'],
      ['registered', 'error'],
      // active cannot go back to registered
      ['active', 'registered'],
      ['active', 'active'],
      ['active', 'decommissioned'],
      // decommissioned is terminal — cannot go anywhere
      ['decommissioned', 'registered'],
      ['decommissioned', 'active'],
      ['decommissioned', 'idle'],
      ['decommissioned', 'suspended'],
      ['decommissioned', 'stopped'],
      ['decommissioned', 'error'],
      // stopped cannot go to idle, suspended, error
      ['stopped', 'idle'],
      ['stopped', 'suspended'],
      ['stopped', 'error'],
      // self-transitions (no-ops are invalid)
      ['registered', 'registered'],
      ['stopped', 'stopped'],
    ];

    it.each(invalidTransitions)('%s → %s should throw INVALID_TRANSITION', (from, to) => {
      try {
        assertTransition(from, to);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('INVALID_TRANSITION');
        expect((err as GovernanceError).category).toBe('config_error');
        expect((err as GovernanceError).message).toContain(from);
        expect((err as GovernanceError).message).toContain(to);
      }
    });
  });
});

describe('Lazy Idle Detection (AD-P5-06)', () => {
  const now = new Date('2026-02-22T12:00:00Z');

  describe('computeEffectiveStatus()', () => {
    it('should return "idle" for active agent past timeout', () => {
      const agent = makeAgent({
        status: 'active',
        lastActiveAt: '2026-02-22T11:00:00Z', // 60min ago
      });
      expect(computeEffectiveStatus(agent, now)).toBe('idle');
    });

    it('should return "active" for active agent within timeout', () => {
      const agent = makeAgent({
        status: 'active',
        lastActiveAt: '2026-02-22T11:45:00Z', // 15min ago
      });
      expect(computeEffectiveStatus(agent, now)).toBe('active');
    });

    it('should return "active" for active agent at exactly 30min (boundary)', () => {
      const agent = makeAgent({
        status: 'active',
        lastActiveAt: '2026-02-22T11:30:00Z', // exactly 30min ago
      });
      // elapsed === timeout → NOT greater than → stays active
      expect(computeEffectiveStatus(agent, now)).toBe('active');
    });

    it('should return "idle" for active agent at 30min + 1ms', () => {
      const agent = makeAgent({
        status: 'active',
        lastActiveAt: new Date(now.getTime() - 30 * 60 * 1000 - 1).toISOString(),
      });
      expect(computeEffectiveStatus(agent, now)).toBe('idle');
    });

    it('should return "active" for idle agent with recent activity', () => {
      const agent = makeAgent({
        status: 'idle',
        lastActiveAt: '2026-02-22T11:50:00Z', // 10min ago
      });
      expect(computeEffectiveStatus(agent, now)).toBe('active');
    });

    it('should return "idle" for idle agent past timeout', () => {
      const agent = makeAgent({
        status: 'idle',
        lastActiveAt: '2026-02-22T10:00:00Z', // 2h ago
      });
      expect(computeEffectiveStatus(agent, now)).toBe('idle');
    });

    it('should return "active" for active agent without lastActiveAt', () => {
      const agent = makeAgent({ status: 'active' });
      expect(computeEffectiveStatus(agent, now)).toBe('active');
    });

    it('should pass through all other statuses unchanged', () => {
      const statuses: AgentRunStatus[] = ['registered', 'suspended', 'stopped', 'error', 'decommissioned'];
      for (const status of statuses) {
        const agent = makeAgent({ status });
        expect(computeEffectiveStatus(agent, now)).toBe(status);
      }
    });

    it('should respect custom timeout', () => {
      const agent = makeAgent({
        status: 'active',
        lastActiveAt: '2026-02-22T11:55:00Z', // 5min ago
      });
      // Default 30min → active; custom 3min → idle
      expect(computeEffectiveStatus(agent, now)).toBe('active');
      expect(computeEffectiveStatus(agent, now, 3 * 60 * 1000)).toBe('idle');
    });
  });
});
