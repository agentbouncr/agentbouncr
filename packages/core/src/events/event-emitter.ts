/**
 * @agentbouncr/core — Event System
 *
 * Async in-process event dispatch via process.nextTick.
 * 20 event types, 100ms timeout per listener.
 * Listeners must NEVER block the governance check.
 */

import type pino from 'pino';

// --- Event Types ---

export type GovernanceEventType =
  | 'tool_call.allowed'
  | 'tool_call.denied'
  | 'tool_call.error'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.rejected'
  | 'approval.timeout'
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.error'
  | 'agent.config_changed'
  | 'injection.detected'
  | 'killswitch.activated'
  | 'killswitch.deactivated'
  | 'audit.integrity_violation'
  | 'audit.write_failure'
  | 'policy.created'
  | 'policy.updated'
  | 'policy.deleted'
  | 'rate_limit.exceeded';

// --- Event Data ---

export interface GovernanceEvent<T = Record<string, unknown>> {
  type: GovernanceEventType;
  timestamp: string;
  traceId?: string;
  agentId?: string;
  tenantId?: string;
  data: T;
}

// --- Listener Type ---

export type GovernanceEventListener<T = Record<string, unknown>> = (
  event: GovernanceEvent<T>,
) => void | Promise<void>;

// --- Event Emitter ---

const LISTENER_TIMEOUT_MS = 100;

export class GovernanceEventEmitter {
  private readonly listeners = new Map<GovernanceEventType, GovernanceEventListener[]>();

  constructor(
    private readonly logger: pino.Logger,
    private readonly traceIdResolver?: () => string | undefined,
  ) {}

  on(type: GovernanceEventType, listener: GovernanceEventListener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  off(type: GovernanceEventType, listener: GovernanceEventListener): void {
    const existing = this.listeners.get(type);
    if (!existing) return;

    const index = existing.indexOf(listener);
    if (index !== -1) {
      existing.splice(index, 1);
    }
  }

  /**
   * Emit event asynchronously via process.nextTick.
   * Listeners are fire-and-forget — they NEVER block the caller.
   * Each listener gets max 100ms before timeout warning.
   *
   * Defensive: Invalid input is logged and silently ignored (JS callers without TS).
   */
  emit(type: GovernanceEventType, data: Record<string, unknown> = {}): void {
    if (!type || typeof type !== 'string') {
      this.logger.warn({ type }, 'emit() called with invalid event type — ignored');
      return;
    }

    const listeners = this.listeners.get(type);
    if (!listeners?.length) return;

    let traceId: string | undefined;
    try {
      traceId = this.traceIdResolver?.();
    } catch (err: unknown) {
      this.logger.warn({ error: String(err) }, 'traceIdResolver threw — ignored');
    }

    const event: GovernanceEvent = {
      type,
      timestamp: new Date().toISOString(),
      traceId,
      data: data && typeof data === 'object' ? data : {},
    };

    for (const listener of listeners) {
      process.nextTick(() => {
        this.executeListener(type, listener, event);
      });
    }
  }

  /**
   * Emit with full event object (when traceId/agentId are known).
   *
   * Defensive: Missing fields are filled with defaults (JS callers without TS).
   */
  emitEvent(event: GovernanceEvent): void {
    if (!event || typeof event !== 'object' || !event.type) {
      this.logger.warn({ event }, 'emitEvent() called with invalid event — ignored');
      return;
    }

    const safeEvent: GovernanceEvent = {
      type: event.type,
      timestamp: event.timestamp || new Date().toISOString(),
      traceId: event.traceId,
      agentId: event.agentId,
      tenantId: event.tenantId,
      data: event.data && typeof event.data === 'object' ? event.data : {},
    };

    const listeners = this.listeners.get(safeEvent.type);
    if (!listeners?.length) return;

    for (const listener of listeners) {
      process.nextTick(() => {
        this.executeListener(safeEvent.type, listener, safeEvent);
      });
    }
  }

  listenerCount(type: GovernanceEventType): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  removeAllListeners(type?: GovernanceEventType): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
    }
  }

  private executeListener(
    type: GovernanceEventType,
    listener: GovernanceEventListener,
    event: GovernanceEvent,
  ): void {
    try {
      const result = listener(event);

      if (result instanceof Promise) {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Event listener timeout (${LISTENER_TIMEOUT_MS}ms)`)),
            LISTENER_TIMEOUT_MS,
          ),
        );

        void Promise.race([result, timeout]).catch((err: unknown) => {
          this.logger.warn(
            { eventType: type, error: String(err) },
            'Event listener failed or timed out',
          );
        });
      }
    } catch (err: unknown) {
      this.logger.warn(
        { eventType: type, error: String(err) },
        'Event listener threw synchronously',
      );
    }
  }
}
