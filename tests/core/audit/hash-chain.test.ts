import { describe, it, expect } from 'vitest';
import { computeAuditHash, verifyAuditEventHash } from '@agentbouncr/core';
import type { HashInput } from '@agentbouncr/core';

const baseInput: HashInput = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  timestamp: '2026-01-15T10:30:00.000Z',
  agentId: 'claims-agent',
  tool: 'file_read',
  result: 'allowed',
  durationMs: 42,
  previousHash: null,
};

describe('Audit Hash-Chain', () => {
  describe('computeAuditHash', () => {
    it('should return a 64-character hex string (SHA-256)', () => {
      const hash = computeAuditHash(baseInput);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be deterministic (same input = same hash)', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash(baseInput);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different traceId', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1' });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different timestamp', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, timestamp: '2026-01-15T10:31:00.000Z' });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different agentId', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, agentId: 'other-agent' });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different tool', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, tool: 'file_write' });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different result', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, result: 'denied' });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different durationMs', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, durationMs: 100 });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different previousHash', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, previousHash: 'abc123' });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different params', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, params: { path: '/etc' } });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different reason', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, reason: 'Policy denied' });
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash for different failureCategory', () => {
      const hash1 = computeAuditHash(baseInput);
      const hash2 = computeAuditHash({ ...baseInput, failureCategory: 'policy_denial' });
      expect(hash1).not.toBe(hash2);
    });

    it('should distinguish null previousHash from string "GENESIS_NULL"', () => {
      const hashNull = computeAuditHash({ ...baseInput, previousHash: null });
      const hashString = computeAuditHash({ ...baseInput, previousHash: 'GENESIS_NULL' });
      // Null uses 'GENESIS_NULL' sentinel, non-null uses 'CHAIN:' prefix → different
      expect(hashNull).not.toBe(hashString);
    });

    it('should produce canonical params hash (sorted keys)', () => {
      const hash1 = computeAuditHash({ ...baseInput, params: { b: 2, a: 1 } });
      const hash2 = computeAuditHash({ ...baseInput, params: { a: 1, b: 2 } });
      expect(hash1).toBe(hash2);
    });
  });

  describe('delimiter injection resistance (JSON serialization)', () => {
    it('should produce different hashes for field values with special characters', () => {
      const inputA: HashInput = {
        ...baseInput,
        agentId: 'claims|agent',
        tool: 'file_read',
      };
      const inputB: HashInput = {
        ...baseInput,
        agentId: 'claims',
        tool: 'agent|file_read',
      };
      expect(computeAuditHash(inputA)).not.toBe(computeAuditHash(inputB));
    });

    it('should handle empty string fields', () => {
      const withEmpty = computeAuditHash({ ...baseInput, tool: '' });
      const withValue = computeAuditHash(baseInput);
      expect(withEmpty).toMatch(/^[a-f0-9]{64}$/);
      expect(withEmpty).not.toBe(withValue);
    });

    it('should handle unicode characters deterministically', () => {
      const input: HashInput = { ...baseInput, agentId: 'agent-\u00e4\u00f6\u00fc-\u2603' };
      const hash1 = computeAuditHash(input);
      const hash2 = computeAuditHash(input);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle durationMs edge values', () => {
      const hashes = [0, -1, 0.5, Number.MAX_SAFE_INTEGER].map(
        (d) => computeAuditHash({ ...baseInput, durationMs: d }),
      );
      for (const h of hashes) {
        expect(h).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(new Set([...hashes, computeAuditHash(baseInput)]).size).toBe(5);
    });
  });

  describe('verifyAuditEventHash', () => {
    it('should return true for correctly hashed event', () => {
      const hash = computeAuditHash(baseInput);
      expect(verifyAuditEventHash({ ...baseInput, hash })).toBe(true);
    });

    it('should return false for tampered event (wrong hash)', () => {
      expect(verifyAuditEventHash({ ...baseInput, hash: 'deadbeef'.repeat(8) })).toBe(false);
    });

    it('should return false for tampered event (modified field)', () => {
      const hash = computeAuditHash(baseInput);
      expect(verifyAuditEventHash({ ...baseInput, result: 'denied', hash })).toBe(false);
    });

    it('should return false for tampered params', () => {
      const hash = computeAuditHash({ ...baseInput, params: { amount: 7500 } });
      expect(verifyAuditEventHash({
        ...baseInput,
        params: { amount: 75 },
        hash,
      })).toBe(false);
    });
  });

  describe('hash-chain integrity', () => {
    it('should form a valid chain across multiple events', () => {
      const event1Input: HashInput = { ...baseInput, previousHash: null };
      const hash1 = computeAuditHash(event1Input);

      const event2Input: HashInput = {
        ...baseInput,
        timestamp: '2026-01-15T10:31:00.000Z',
        tool: 'file_write',
        previousHash: hash1,
      };
      const hash2 = computeAuditHash(event2Input);

      const event3Input: HashInput = {
        ...baseInput,
        timestamp: '2026-01-15T10:32:00.000Z',
        tool: 'search_web',
        previousHash: hash2,
      };
      const hash3 = computeAuditHash(event3Input);

      expect(verifyAuditEventHash({ ...event1Input, hash: hash1 })).toBe(true);
      expect(verifyAuditEventHash({ ...event2Input, hash: hash2 })).toBe(true);
      expect(verifyAuditEventHash({ ...event3Input, hash: hash3 })).toBe(true);

      expect(new Set([hash1, hash2, hash3]).size).toBe(3);
    });

    it('should detect broken chain link', () => {
      const hash1 = computeAuditHash({ ...baseInput, previousHash: null });

      const event2Tampered: HashInput = {
        ...baseInput,
        timestamp: '2026-01-15T10:31:00.000Z',
        previousHash: 'wrong_hash_here',
      };
      const hash2 = computeAuditHash(event2Tampered);

      expect(verifyAuditEventHash({
        ...baseInput,
        timestamp: '2026-01-15T10:31:00.000Z',
        previousHash: hash1,
        hash: hash2,
      })).toBe(false);
    });
  });
});
