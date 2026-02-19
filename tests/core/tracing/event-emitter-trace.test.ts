import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { GovernanceEventEmitter } from '@agentbouncr/core';
import type { GovernanceEvent } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

function nextTick(): Promise<void> {
  return new Promise((resolve) => process.nextTick(resolve));
}

describe('GovernanceEventEmitter — traceIdResolver integration', () => {
  describe('with traceIdResolver', () => {
    it('should auto-populate traceId on emit()', async () => {
      const resolver = () => '4bf92f3577b34da6a3ce929d0e0e4736';
      const emitter = new GovernanceEventEmitter(silentLogger, resolver);
      const listener = vi.fn();

      emitter.on('tool_call.allowed', listener);
      emitter.emit('tool_call.allowed', { tool: 'file_read' });
      await nextTick();

      expect(listener).toHaveBeenCalledOnce();
      const event: GovernanceEvent = listener.mock.calls[0][0];
      expect(event.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    });

    it('should set traceId to undefined when resolver returns undefined', async () => {
      const resolver = () => undefined;
      const emitter = new GovernanceEventEmitter(silentLogger, resolver);
      const listener = vi.fn();

      emitter.on('policy.created', listener);
      emitter.emit('policy.created', { name: 'test' });
      await nextTick();

      const event: GovernanceEvent = listener.mock.calls[0][0];
      expect(event.traceId).toBeUndefined();
    });
  });

  describe('without traceIdResolver (backward compatibility)', () => {
    it('should produce events without traceId', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const listener = vi.fn();

      emitter.on('tool_call.denied', listener);
      emitter.emit('tool_call.denied', { tool: 'file_write' });
      await nextTick();

      const event: GovernanceEvent = listener.mock.calls[0][0];
      expect(event.traceId).toBeUndefined();
    });
  });

  describe('traceIdResolver error handling (H-01 security fix)', () => {
    it('should not crash emit() when traceIdResolver throws', async () => {
      const badResolver = () => { throw new Error('resolver boom'); };
      const emitter = new GovernanceEventEmitter(silentLogger, badResolver);
      const listener = vi.fn();

      emitter.on('agent.error', listener);
      expect(() => emitter.emit('agent.error', { reason: 'test' })).not.toThrow();
      await nextTick();

      expect(listener).toHaveBeenCalledOnce();
      const event: GovernanceEvent = listener.mock.calls[0][0];
      expect(event.traceId).toBeUndefined();
    });
  });

  describe('emitEvent() with explicit traceId', () => {
    it('should preserve explicit traceId regardless of resolver', async () => {
      const resolver = () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
      const emitter = new GovernanceEventEmitter(silentLogger, resolver);
      const listener = vi.fn();

      emitter.on('injection.detected', listener);
      emitter.emitEvent({
        type: 'injection.detected',
        timestamp: new Date().toISOString(),
        traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2',
        data: { patterns: ['test'] },
      });
      await nextTick();

      const event: GovernanceEvent = listener.mock.calls[0][0];
      // emitEvent uses the event's own traceId, not the resolver
      expect(event.traceId).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2');
    });
  });
});
