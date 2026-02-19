/**
 * @agentbouncr/core — Tracing Module (W3C Trace Context)
 */

export { TraceProvider } from './trace-provider.js';

export {
  createTraceContext,
  generateTraceId,
  generateSpanId,
  isValidTraceId,
  isValidSpanId,
  parseTraceparent,
  type TraceContext,
} from './trace-context.js';
