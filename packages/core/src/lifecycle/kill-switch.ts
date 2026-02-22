/**
 * @agentbouncr/core — Kill-Switch Manager
 *
 * Deterministic emergency stop — no LLM, no network.
 * Once activated, all evaluate() calls are denied.
 * Reset requires explicit admin action (no auto-recovery).
 */

import type pino from 'pino';
import type { GovernanceEventEmitter } from '../events/event-emitter.js';

// --- Types ---

export interface KillSwitchStatus {
  active: boolean;
  activatedAt?: string;
  reason?: string;
}

// --- Kill-Switch Manager ---

export class KillSwitchManager {
  // Global state (Stufe-1 users without tenantId)
  private globalActive = false;
  private globalActivatedAt?: string;
  private globalReason?: string;
  private globalSuspendedAgentIds = new Set<string>();

  // Per-tenant state (Multi-Tenant)
  private readonly tenantState = new Map<string, {
    active: boolean;
    activatedAt?: string;
    reason?: string;
    suspendedAgentIds: Set<string>;
  }>();

  constructor(
    private readonly logger: pino.Logger,
    private readonly eventEmitter?: GovernanceEventEmitter,
  ) {}

  /**
   * Check if the kill-switch is currently active.
   * With tenantId: checks tenant-specific state.
   * Without: checks global state.
   */
  isActive(tenantId?: string): boolean {
    if (tenantId) {
      return this.tenantState.get(tenantId)?.active ?? false;
    }
    return this.globalActive;
  }

  /**
   * Activate the kill-switch. All governance evaluations will be denied.
   * Idempotent — calling activate() when already active is a no-op.
   * With tenantId: only affects the specified tenant.
   */
  activate(reason: string, tenantId?: string): void {
    if (tenantId) {
      const state = this.tenantState.get(tenantId);
      if (state?.active) return;

      const activatedAt = new Date().toISOString();
      this.tenantState.set(tenantId, { active: true, activatedAt, reason, suspendedAgentIds: new Set() });

      this.logger.fatal(
        { reason, activatedAt, tenantId },
        'Kill-Switch activated — all tool calls will be denied',
      );

      this.eventEmitter?.emitEvent({
        type: 'killswitch.activated',
        timestamp: activatedAt,
        tenantId,
        data: { reason, tenantId },
      });
      return;
    }

    if (this.globalActive) return;

    this.globalActive = true;
    this.globalActivatedAt = new Date().toISOString();
    this.globalReason = reason;

    this.logger.fatal(
      { reason, activatedAt: this.globalActivatedAt },
      'Kill-Switch activated — all tool calls will be denied',
    );

    this.eventEmitter?.emitEvent({
      type: 'killswitch.activated',
      timestamp: this.globalActivatedAt,
      data: { reason },
    });
  }

  /**
   * Reset the kill-switch. Requires explicit admin action.
   * With tenantId: resets only the specified tenant.
   */
  reset(tenantId?: string, reason?: string): void {
    if (tenantId) {
      const state = this.tenantState.get(tenantId);
      if (!state?.active) return;

      this.logger.warn(
        { previousReason: state.reason, activatedAt: state.activatedAt, tenantId, resetReason: reason },
        'Kill-Switch reset',
      );

      this.tenantState.delete(tenantId);

      this.eventEmitter?.emitEvent({
        type: 'killswitch.deactivated',
        timestamp: new Date().toISOString(),
        tenantId,
        data: { reason: reason ?? 'Manual reset', previousReason: state.reason, tenantId },
      });
      return;
    }

    if (!this.globalActive) return;

    const previousReason = this.globalReason;
    const activatedAt = this.globalActivatedAt;

    this.logger.warn(
      { previousReason, activatedAt, resetReason: reason },
      'Kill-Switch reset',
    );

    this.globalActive = false;
    this.globalActivatedAt = undefined;
    this.globalReason = undefined;
    this.globalSuspendedAgentIds.clear();

    this.eventEmitter?.emitEvent({
      type: 'killswitch.deactivated',
      timestamp: new Date().toISOString(),
      data: { reason: reason ?? 'Manual reset', previousReason },
    });
  }

  /**
   * Track an agent that was suspended by the kill-switch.
   * Used by GovernanceMiddleware.emergencyStop() to remember which agents
   * were suspended by the kill-switch (vs. manually suspended before).
   */
  trackSuspendedAgent(agentId: string, tenantId?: string): void {
    if (tenantId) {
      this.tenantState.get(tenantId)?.suspendedAgentIds.add(agentId);
    } else {
      this.globalSuspendedAgentIds.add(agentId);
    }
  }

  /**
   * Get the set of agent IDs suspended by the kill-switch.
   * Used by GovernanceMiddleware.resetKillSwitch() to reactivate only these agents.
   */
  getSuspendedAgentIds(tenantId?: string): ReadonlySet<string> {
    if (tenantId) {
      return this.tenantState.get(tenantId)?.suspendedAgentIds ?? new Set();
    }
    return this.globalSuspendedAgentIds;
  }

  /**
   * Get the current kill-switch status.
   * With tenantId: returns tenant-specific status.
   */
  getStatus(tenantId?: string): KillSwitchStatus {
    if (tenantId) {
      const state = this.tenantState.get(tenantId);
      return {
        active: state?.active ?? false,
        activatedAt: state?.activatedAt,
        reason: state?.reason,
      };
    }
    return {
      active: this.globalActive,
      activatedAt: this.globalActivatedAt,
      reason: this.globalReason,
    };
  }
}
