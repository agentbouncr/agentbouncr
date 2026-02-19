/**
 * @agentbouncr/core — W3C Trace Context Primitives
 *
 * Trace-ID-Generierung und -Validierung nach W3C Trace Context Standard.
 * https://www.w3.org/TR/trace-context/
 *
 * Format:
 *   traceId:     32 hex chars (128 bit)
 *   spanId:      16 hex chars (64 bit)
 *   traceparent: "00-{traceId}-{spanId}-{flags}"
 */

import { randomBytes } from 'node:crypto';

// --- Types ---

export interface TraceContext {
  /** 32 lowercase hex characters (128-bit trace identifier) */
  readonly traceId: string;
  /** 16 lowercase hex characters (64-bit span identifier) */
  readonly spanId: string;
  /** Full W3C traceparent header value */
  readonly traceparent: string;
}

// --- Constants ---

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;
const TRACE_VERSION = '00';
const TRACE_FLAGS_SAMPLED = '01';

const TRACE_ID_REGEX = /^[0-9a-f]{32}$/;
const SPAN_ID_REGEX = /^[0-9a-f]{16}$/;
const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ALL_ZEROS_TRACE_ID = '0'.repeat(32);
const ALL_ZEROS_SPAN_ID = '0'.repeat(16);

// --- Generation ---

export function generateTraceId(): string {
  return randomBytes(TRACE_ID_BYTES).toString('hex');
}

export function generateSpanId(): string {
  return randomBytes(SPAN_ID_BYTES).toString('hex');
}

// --- Validation ---

export function isValidTraceId(traceId: string): boolean {
  return TRACE_ID_REGEX.test(traceId) && traceId !== ALL_ZEROS_TRACE_ID;
}

export function isValidSpanId(spanId: string): boolean {
  return SPAN_ID_REGEX.test(spanId) && spanId !== ALL_ZEROS_SPAN_ID;
}

// --- traceparent formatting ---

function formatTraceparent(traceId: string, spanId: string): string {
  return `${TRACE_VERSION}-${traceId}-${spanId}-${TRACE_FLAGS_SAMPLED}`;
}

// --- Factory ---

/**
 * Create a TraceContext. Reuses valid traceId/spanId if provided,
 * otherwise generates new ones.
 */
export function createTraceContext(traceId?: string, spanId?: string): TraceContext {
  const validTraceId = traceId && isValidTraceId(traceId) ? traceId : generateTraceId();
  const validSpanId = spanId && isValidSpanId(spanId) ? spanId : generateSpanId();

  return {
    traceId: validTraceId,
    spanId: validSpanId,
    traceparent: formatTraceparent(validTraceId, validSpanId),
  };
}

// --- Parsing ---

/**
 * Parse a W3C traceparent header string into a TraceContext.
 * Returns null for invalid formats.
 *
 * Format: "{version}-{traceId}-{spanId}-{flags}"
 * Example: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
 */
export function parseTraceparent(header: string): TraceContext | null {
  const match = header.match(TRACEPARENT_REGEX);
  if (!match) return null;

  const [, , traceId, spanId] = match;

  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) return null;

  return {
    traceId,
    spanId,
    traceparent: header,
  };
}
