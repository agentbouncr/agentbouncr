/**
 * @agentbouncr/core — Audit Trail Hash-Chain
 *
 * SHA-256 Hash-Chain fuer manipulationssicheren Audit Trail.
 * <100 LOC, keine externe Dependency — nur Node.js crypto.
 *
 * Jeder Eintrag enthaelt den Hash des vorherigen Eintrags.
 * Erster Eintrag: previousHash = null → strukturell unterscheidbar.
 *
 * Serialisierung: JSON-Array (keine Delimiter-Injection moeglich).
 * Timing-sicherer Vergleich via crypto.timingSafeEqual.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

// --- Types ---

export interface HashInput {
  traceId: string;
  timestamp: string;
  agentId: string;
  tool: string;
  params?: Record<string, unknown>;
  result: string;
  reason?: string;
  durationMs: number;
  failureCategory?: string;
  previousHash: string | null;
}

// --- Hash Functions ---

/**
 * Canonical JSON for params: sorted keys for determinism.
 * Returns empty string for undefined/null.
 */
function canonicalParams(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const keys = Object.keys(params).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) {
    sorted[key] = params[key];
  }
  return JSON.stringify(sorted);
}

/**
 * Compute SHA-256 hash for an audit event.
 *
 * Serialization: JSON array of all fields (no delimiter injection possible).
 * First event uses ["GENESIS_NULL"] sentinel; chained events use ["CHAIN", hash].
 */
export function computeAuditHash(input: HashInput): string {
  const fields = [
    input.previousHash === null ? 'GENESIS_NULL' : `CHAIN:${input.previousHash}`,
    input.traceId,
    input.timestamp,
    input.agentId,
    input.tool,
    canonicalParams(input.params),
    input.result,
    input.reason ?? '',
    String(input.durationMs),
    input.failureCategory ?? '',
  ];

  const payload = JSON.stringify(fields);
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Verify that an audit event's hash matches its content.
 * Uses timing-safe comparison to prevent side-channel attacks.
 */
export function verifyAuditEventHash(event: HashInput & { hash: string }): boolean {
  const computed = computeAuditHash(event);
  const computedBuf = Buffer.from(computed, 'hex');
  const storedBuf = Buffer.from(event.hash, 'hex');
  if (computedBuf.length !== storedBuf.length) return false;
  return timingSafeEqual(computedBuf, storedBuf);
}
