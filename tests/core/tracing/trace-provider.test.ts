import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { TraceProvider, isValidTraceId, isValidSpanId } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

describe('TraceProvider', () => {
  let provider: TraceProvider;

  beforeEach(() => {
    provider = new TraceProvider(silentLogger);
  });

  describe('DI — no singletons', () => {
    it('should be instantiable with logger', () => {
      expect(provider).toBeInstanceOf(TraceProvider);
    });

    it('should accept custom service name', () => {
      const custom = new TraceProvider(silentLogger, 'my-service');
      expect(custom).toBeInstanceOf(TraceProvider);
    });

    it('should not share state between instances', () => {
      const provider2 = new TraceProvider(silentLogger);

      const traceId1 = provider.run(() => provider.getTraceId());
      const traceId2 = provider2.run(() => provider2.getTraceId());

      expect(traceId1).toBeDefined();
      expect(traceId2).toBeDefined();
      expect(traceId1).not.toBe(traceId2);
    });
  });

  describe('run() — synchronous', () => {
    it('should make traceId available inside callback', () => {
      const traceId = provider.run(() => provider.getTraceId());
      expect(traceId).toBeDefined();
      expect(isValidTraceId(traceId as string)).toBe(true);
    });

    it('should make full TraceContext available inside callback', () => {
      const ctx = provider.run(() => provider.getTraceContext());
      expect(ctx).toBeDefined();
      if (!ctx) return;
      expect(isValidTraceId(ctx.traceId)).toBe(true);
      expect(isValidSpanId(ctx.spanId)).toBe(true);
      expect(ctx.traceparent).toContain(ctx.traceId);
      expect(ctx.traceparent).toContain(ctx.spanId);
    });

    it('should reuse provided traceId', () => {
      const existingId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const traceId = provider.run(
        () => provider.getTraceId(),
        { traceId: existingId },
      );
      expect(traceId).toBe(existingId);
    });

    it('should generate new traceId when not provided', () => {
      const traceId = provider.run(() => provider.getTraceId());
      expect(traceId).toBeDefined();
      expect(isValidTraceId(traceId as string)).toBe(true);
    });

    it('should generate new traceId when invalid one is provided', () => {
      const traceId = provider.run(
        () => provider.getTraceId(),
        { traceId: 'invalid' },
      );
      expect(traceId).toBeDefined();
      expect(traceId).not.toBe('invalid');
      expect(isValidTraceId(traceId as string)).toBe(true);
    });

    it('should return the result of the callback', () => {
      const result = provider.run(() => 42);
      expect(result).toBe(42);
    });

    it('should propagate errors from the callback', () => {
      expect(() => {
        provider.run(() => { throw new Error('boom'); });
      }).toThrow('boom');
    });
  });

  describe('run() — asynchronous', () => {
    it('should make traceId available in async callback', async () => {
      const traceId = await provider.run(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return provider.getTraceId();
      });
      expect(traceId).toBeDefined();
      expect(isValidTraceId(traceId as string)).toBe(true);
    });

    it('should propagate traceId through Promise.then chains', async () => {
      const traceId = await provider.run(() => {
        return Promise.resolve()
          .then(() => new Promise((r) => setTimeout(r, 5)))
          .then(() => provider.getTraceId());
      });
      expect(traceId).toBeDefined();
      expect(isValidTraceId(traceId as string)).toBe(true);
    });

    it('should propagate errors from async callback', async () => {
      await expect(
        provider.run(async () => { throw new Error('async boom'); }),
      ).rejects.toThrow('async boom');
    });

    it('should return the result of async callback', async () => {
      const result = await provider.run(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 'hello';
      });
      expect(result).toBe('hello');
    });
  });

  describe('getTraceId() / getTraceContext() outside run()', () => {
    it('should return undefined for getTraceId() outside run()', () => {
      expect(provider.getTraceId()).toBeUndefined();
    });

    it('should return undefined for getTraceContext() outside run()', () => {
      expect(provider.getTraceContext()).toBeUndefined();
    });
  });

  describe('nested run() calls', () => {
    it('should create separate contexts for nested runs', () => {
      const outerTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';

      provider.run(() => {
        const inner = provider.run(() => provider.getTraceId());
        const outer = provider.getTraceId();

        // Inner gets its own generated traceId
        expect(inner).toBeDefined();
        expect(outer).toBe(outerTraceId);
        expect(inner).not.toBe(outer);
      }, { traceId: outerTraceId });
    });
  });

  describe('getLogger()', () => {
    it('should return child logger with traceId inside run()', () => {
      const p = new TraceProvider(silentLogger);
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';

      p.run(() => {
        const log = p.getLogger();
        // Pino child loggers have bindings accessible via [Symbol] or by checking output
        // We verify it's not the same reference as the base logger
        expect(log).not.toBe(silentLogger);

        // Verify the trace context is set correctly
        const ctx = p.getTraceContext();
        expect(ctx).toBeDefined();
        if (!ctx) return;
        expect(ctx.traceId).toBe(traceId);
      }, { traceId });
    });

    it('should return base logger outside run()', () => {
      const log = provider.getLogger();
      expect(log).toBe(silentLogger);
    });
  });

  describe('span name configuration', () => {
    it('should accept custom span name without error', () => {
      expect(() => {
        provider.run(() => 'ok', { spanName: 'governance.evaluate' });
      }).not.toThrow();
    });

    it('should work with default span name', () => {
      expect(() => {
        provider.run(() => 'ok');
      }).not.toThrow();
    });
  });

  describe('OTel no-SDK scenario (default)', () => {
    it('should work without OTel SDK registered (no-op tracer)', () => {
      // By default, no OTel SDK is registered. The provider should still
      // generate trace IDs and function correctly.
      const traceId = provider.run(() => provider.getTraceId());
      expect(traceId).toBeDefined();
      expect(isValidTraceId(traceId as string)).toBe(true);
    });

    it('should complete async operations without OTel SDK', async () => {
      const result = await provider.run(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return provider.getTraceId();
      });
      expect(result).toBeDefined();
      expect(isValidTraceId(result as string)).toBe(true);
    });
  });
});
