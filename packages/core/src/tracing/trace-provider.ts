/**
 * @agentbouncr/core — TraceProvider
 *
 * DI-injectable Trace-Kontext-Management mit:
 * - AsyncLocalStorage fuer implizite Propagation
 * - OTel-API-Bridge (no-op wenn kein SDK registriert)
 * - Pino child-Logger mit traceId/spanId gebunden
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { trace, type Tracer, type Span, SpanKind } from '@opentelemetry/api';
import type pino from 'pino';
import {
  createTraceContext,
  generateSpanId,
  type TraceContext,
} from './trace-context.js';

// --- Internal Store ---

interface TraceStore {
  traceContext: TraceContext;
  logger: pino.Logger;
}

// --- TraceProvider ---

export class TraceProvider {
  private readonly storage = new AsyncLocalStorage<TraceStore>();
  private readonly tracer: Tracer;

  constructor(
    private readonly logger: pino.Logger,
    serviceName: string = '@agentbouncr/core',
  ) {
    this.tracer = trace.getTracer(serviceName);
  }

  /**
   * Execute fn within a traced scope. TraceId is available via
   * getTraceId()/getTraceContext() anywhere inside fn (sync or async).
   *
   * Priority for traceId:
   * 1. options.traceId (caller-provided, e.g. from EvaluateRequest)
   * 2. Active OTel span context (if SDK registered)
   * 3. Generate new W3C-compliant trace ID
   */
  run<T>(
    fn: () => T,
    options?: { traceId?: string; spanName?: string },
  ): T {
    // Determine trace context
    let traceCtx: TraceContext;

    if (options?.traceId) {
      traceCtx = createTraceContext(options.traceId);
    } else {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        const spanCtx = activeSpan.spanContext();
        traceCtx = createTraceContext(spanCtx.traceId, generateSpanId());
      } else {
        traceCtx = createTraceContext();
      }
    }

    const childLogger = this.logger.child({
      traceId: traceCtx.traceId,
      spanId: traceCtx.spanId,
    });

    const store: TraceStore = { traceContext: traceCtx, logger: childLogger };
    const spanName = options?.spanName ?? 'governance.operation';

    return this.tracer.startActiveSpan(
      spanName,
      { kind: SpanKind.INTERNAL },
      (span: Span) => {
        return this.storage.run(store, () => {
          try {
            const result = fn();

            if (result instanceof Promise) {
              return (result as Promise<unknown>).then(
                (val) => { span.end(); return val; },
                (err: unknown) => { span.end(); throw err; },
              ) as T;
            }

            span.end();
            return result;
          } catch (err: unknown) {
            span.end();
            throw err;
          }
        });
      },
    );
  }

  /**
   * Get the active TraceContext. Returns undefined outside run() scope.
   */
  getTraceContext(): TraceContext | undefined {
    return this.storage.getStore()?.traceContext;
  }

  /**
   * Convenience: get just the traceId. Returns undefined outside run() scope.
   */
  getTraceId(): string | undefined {
    return this.storage.getStore()?.traceContext.traceId;
  }

  /**
   * Get the context-bound logger (with traceId/spanId fields).
   * Falls back to the base logger outside run() scope.
   */
  getLogger(): pino.Logger {
    return this.storage.getStore()?.logger ?? this.logger;
  }
}
