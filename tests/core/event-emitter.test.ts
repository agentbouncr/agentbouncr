import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { GovernanceEventEmitter } from '@agentbouncr/core';
import type { GovernanceEvent, GovernanceEventType } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

/** Wait for process.nextTick to fire */
function nextTick(): Promise<void> {
  return new Promise((resolve) => process.nextTick(resolve));
}

/** Wait for nextTick + async listener to complete */
function settle(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('GovernanceEventEmitter', () => {
  let emitter: GovernanceEventEmitter;

  beforeEach(() => {
    emitter = new GovernanceEventEmitter(silentLogger);
  });

  describe('on / off', () => {
    it('should register a listener', () => {
      const listener = vi.fn();
      emitter.on('tool_call.allowed', listener);
      expect(emitter.listenerCount('tool_call.allowed')).toBe(1);
    });

    it('should remove a listener', () => {
      const listener = vi.fn();
      emitter.on('tool_call.allowed', listener);
      emitter.off('tool_call.allowed', listener);
      expect(emitter.listenerCount('tool_call.allowed')).toBe(0);
    });

    it('should not throw when removing non-existent listener', () => {
      expect(() => emitter.off('tool_call.allowed', vi.fn())).not.toThrow();
    });

    it('should support multiple listeners for same event', () => {
      emitter.on('tool_call.denied', vi.fn());
      emitter.on('tool_call.denied', vi.fn());
      expect(emitter.listenerCount('tool_call.denied')).toBe(2);
    });
  });

  describe('emit', () => {
    it('should call registered listener asynchronously', async () => {
      const listener = vi.fn();
      emitter.on('tool_call.allowed', listener);

      emitter.emit('tool_call.allowed', { tool: 'file_read' });

      // Listener should NOT be called synchronously
      expect(listener).not.toHaveBeenCalled();

      // After nextTick, listener should be called
      await nextTick();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should pass GovernanceEvent with type and timestamp', async () => {
      const listener = vi.fn();
      emitter.on('injection.detected', listener);

      emitter.emit('injection.detected', { patterns: ['admin_mode'] });

      await nextTick();

      const event: GovernanceEvent = listener.mock.calls[0][0];
      expect(event.type).toBe('injection.detected');
      expect(event.timestamp).toBeDefined();
      expect(new Date(event.timestamp).getTime()).not.toBeNaN();
      expect(event.data).toEqual({ patterns: ['admin_mode'] });
    });

    it('should call all listeners for an event type', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      emitter.on('policy.created', listener1);
      emitter.on('policy.created', listener2);

      emitter.emit('policy.created', { name: 'restrict-fs' });

      await nextTick();
      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();
    });

    it('should not call listeners of other event types', async () => {
      const listener = vi.fn();
      emitter.on('tool_call.allowed', listener);

      emitter.emit('tool_call.denied', { tool: 'file_write' });

      await nextTick();
      expect(listener).not.toHaveBeenCalled();
    });

    it('should not throw when no listeners are registered', () => {
      expect(() => emitter.emit('killswitch.activated')).not.toThrow();
    });
  });

  describe('emitEvent', () => {
    it('should emit a pre-built event object', async () => {
      const listener = vi.fn();
      emitter.on('tool_call.denied', listener);

      const event: GovernanceEvent = {
        type: 'tool_call.denied',
        timestamp: new Date().toISOString(),
        traceId: 'abc-123',
        agentId: 'claims-agent',
        data: { tool: 'approve_payment' },
      };

      emitter.emitEvent(event);
      await nextTick();

      expect(listener).toHaveBeenCalledWith(event);
    });
  });

  describe('async listener error handling', () => {
    it('should not throw when synchronous listener throws', async () => {
      const badListener = () => {
        throw new Error('sync boom');
      };
      emitter.on('agent.error', badListener);

      expect(() => emitter.emit('agent.error')).not.toThrow();
      await nextTick();
      // No unhandled error — the emitter catches it
    });

    it('should not throw when async listener rejects', async () => {
      const badListener = async () => {
        throw new Error('async boom');
      };
      emitter.on('agent.error', badListener);

      expect(() => emitter.emit('agent.error')).not.toThrow();
      await settle(50);
      // No unhandled rejection — the emitter catches it
    });

    it('should handle listener that exceeds 100ms timeout', async () => {
      const slowListener = () =>
        new Promise<void>((resolve) => setTimeout(resolve, 200));
      emitter.on('tool_call.allowed', slowListener);

      expect(() => emitter.emit('tool_call.allowed')).not.toThrow();
      await settle(150);
      // The timeout should be logged but not throw
    });

    it('should log warning when async listener exceeds 100ms timeout', async () => {
      const warnCalls: unknown[] = [];
      const mockLogger = {
        warn: (...args: unknown[]) => { warnCalls.push(args); },
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => mockLogger,
        level: 'silent',
      } as unknown as pino.Logger;

      const localEmitter = new GovernanceEventEmitter(mockLogger);
      const slowListener = () => new Promise<void>((resolve) => setTimeout(resolve, 200));
      localEmitter.on('tool_call.allowed', slowListener);

      localEmitter.emit('tool_call.allowed');
      await settle(150);

      expect(warnCalls.length).toBeGreaterThanOrEqual(1);
      const lastCall = warnCalls[warnCalls.length - 1] as [Record<string, unknown>, string];
      expect(lastCall[0]).toHaveProperty('eventType', 'tool_call.allowed');
      expect(lastCall[1]).toContain('timed out');
    });

    it('should log warning when synchronous listener throws', async () => {
      const warnCalls: unknown[] = [];
      const mockLogger = {
        warn: (...args: unknown[]) => { warnCalls.push(args); },
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => mockLogger,
        level: 'silent',
      } as unknown as pino.Logger;

      const localEmitter = new GovernanceEventEmitter(mockLogger);
      localEmitter.on('agent.error', () => { throw new Error('sync boom'); });

      localEmitter.emit('agent.error');
      await nextTick();

      expect(warnCalls.length).toBeGreaterThanOrEqual(1);
      const lastCall = warnCalls[warnCalls.length - 1] as [Record<string, unknown>, string];
      expect(lastCall[0]).toHaveProperty('eventType', 'agent.error');
      expect(lastCall[1]).toContain('threw synchronously');
    });
  });

  describe('defensive input handling (JS callers without TS)', () => {
    it('should not crash when emit() is called with null type', () => {
      expect(() => emitter.emit(null as never)).not.toThrow();
    });

    it('should not crash when emit() is called with undefined type', () => {
      expect(() => emitter.emit(undefined as never)).not.toThrow();
    });

    it('should not crash when emit() is called with non-string type', () => {
      expect(() => emitter.emit(42 as never)).not.toThrow();
    });

    it('should not crash when emit() data is not an object', () => {
      const listener = vi.fn();
      emitter.on('tool_call.allowed', listener);

      expect(() => emitter.emit('tool_call.allowed', 'bad' as never)).not.toThrow();

      // Listener should still be called with data normalized to {}
      return nextTick().then(() => {
        expect(listener).toHaveBeenCalledOnce();
        const event = listener.mock.calls[0][0] as GovernanceEvent;
        expect(event.data).toEqual({});
      });
    });

    it('should not crash when emitEvent() is called with null', () => {
      expect(() => emitter.emitEvent(null as never)).not.toThrow();
    });

    it('should not crash when emitEvent() is called with undefined', () => {
      expect(() => emitter.emitEvent(undefined as never)).not.toThrow();
    });

    it('should not crash when emitEvent() is called with empty object', () => {
      expect(() => emitter.emitEvent({} as never)).not.toThrow();
    });

    it('should fill missing timestamp in emitEvent()', async () => {
      const listener = vi.fn();
      emitter.on('tool_call.denied', listener);

      // JS caller might forget timestamp
      emitter.emitEvent({ type: 'tool_call.denied', data: { tool: 'x' } } as GovernanceEvent);
      await nextTick();

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0] as GovernanceEvent;
      expect(event.timestamp).toBeDefined();
      expect(new Date(event.timestamp).getTime()).not.toBeNaN();
    });

    it('should normalize missing data in emitEvent() to empty object', async () => {
      const listener = vi.fn();
      emitter.on('injection.detected', listener);

      // JS caller might omit data entirely
      emitter.emitEvent({ type: 'injection.detected', timestamp: '2026-01-01' } as GovernanceEvent);
      await nextTick();

      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0] as GovernanceEvent;
      expect(event.data).toEqual({});
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for a specific event', () => {
      emitter.on('tool_call.allowed', vi.fn());
      emitter.on('tool_call.allowed', vi.fn());
      emitter.on('tool_call.denied', vi.fn());

      emitter.removeAllListeners('tool_call.allowed');

      expect(emitter.listenerCount('tool_call.allowed')).toBe(0);
      expect(emitter.listenerCount('tool_call.denied')).toBe(1);
    });

    it('should remove all listeners when called without type', () => {
      emitter.on('tool_call.allowed', vi.fn());
      emitter.on('tool_call.denied', vi.fn());
      emitter.on('injection.detected', vi.fn());

      emitter.removeAllListeners();

      expect(emitter.listenerCount('tool_call.allowed')).toBe(0);
      expect(emitter.listenerCount('tool_call.denied')).toBe(0);
      expect(emitter.listenerCount('injection.detected')).toBe(0);
    });
  });

  describe('all 20 event types', () => {
    const allEventTypes: GovernanceEventType[] = [
      'tool_call.allowed',
      'tool_call.denied',
      'tool_call.error',
      'approval.requested',
      'approval.granted',
      'approval.rejected',
      'approval.timeout',
      'agent.started',
      'agent.stopped',
      'agent.error',
      'agent.config_changed',
      'injection.detected',
      'killswitch.activated',
      'killswitch.deactivated',
      'audit.integrity_violation',
      'audit.write_failure',
      'policy.created',
      'policy.updated',
      'policy.deleted',
      'rate_limit.exceeded',
    ];

    it('should have exactly 20 event types', () => {
      expect(allEventTypes).toHaveLength(20);
    });

    it('should accept all 20 event types for emit', async () => {
      for (const type of allEventTypes) {
        const listener = vi.fn();
        emitter.on(type, listener);
        emitter.emit(type, { test: true });
        await nextTick();
        expect(listener).toHaveBeenCalledOnce();
        emitter.removeAllListeners(type);
      }
    });
  });
});
