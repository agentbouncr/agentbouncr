import { describe, it, expect } from 'vitest';
import {
  generateTraceId,
  generateSpanId,
  createTraceContext,
  isValidTraceId,
  isValidSpanId,
  parseTraceparent,
} from '@agentbouncr/core';

describe('W3C Trace Context Primitives', () => {
  describe('generateTraceId', () => {
    it('should produce a 32-character lowercase hex string', () => {
      const id = generateTraceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should produce unique values', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
      expect(ids.size).toBe(100);
    });

    it('should never produce all-zeros', () => {
      for (let i = 0; i < 50; i++) {
        expect(generateTraceId()).not.toBe('0'.repeat(32));
      }
    });
  });

  describe('generateSpanId', () => {
    it('should produce a 16-character lowercase hex string', () => {
      const id = generateSpanId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should produce unique values', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('isValidTraceId', () => {
    it('should accept valid 32-hex trace IDs', () => {
      expect(isValidTraceId('4bf92f3577b34da6a3ce929d0e0e4736')).toBe(true);
      expect(isValidTraceId('abcdef0123456789abcdef0123456789')).toBe(true);
    });

    it('should reject all-zeros (W3C spec)', () => {
      expect(isValidTraceId('0'.repeat(32))).toBe(false);
    });

    it('should reject too short', () => {
      expect(isValidTraceId('4bf92f3577b34da6')).toBe(false);
    });

    it('should reject too long', () => {
      expect(isValidTraceId('4bf92f3577b34da6a3ce929d0e0e47360')).toBe(false);
    });

    it('should reject uppercase hex', () => {
      expect(isValidTraceId('4BF92F3577B34DA6A3CE929D0E0E4736')).toBe(false);
    });

    it('should reject non-hex characters', () => {
      expect(isValidTraceId('4bf92f3577b34da6a3ce929d0e0e473g')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidTraceId('')).toBe(false);
    });
  });

  describe('isValidSpanId', () => {
    it('should accept valid 16-hex span IDs', () => {
      expect(isValidSpanId('00f067aa0ba902b7')).toBe(true);
    });

    it('should reject all-zeros (W3C spec)', () => {
      expect(isValidSpanId('0'.repeat(16))).toBe(false);
    });

    it('should reject wrong length', () => {
      expect(isValidSpanId('00f067aa')).toBe(false);
      expect(isValidSpanId('00f067aa0ba902b700')).toBe(false);
    });

    it('should reject non-hex characters', () => {
      expect(isValidSpanId('00f067aa0ba902bx')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidSpanId('')).toBe(false);
    });

    it('should reject uppercase hex', () => {
      expect(isValidSpanId('00F067AA0BA902B7')).toBe(false);
    });
  });

  describe('createTraceContext', () => {
    it('should generate new traceId and spanId when called without arguments', () => {
      const ctx = createTraceContext();
      expect(isValidTraceId(ctx.traceId)).toBe(true);
      expect(isValidSpanId(ctx.spanId)).toBe(true);
    });

    it('should produce a valid traceparent header', () => {
      const ctx = createTraceContext();
      expect(ctx.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(ctx.traceparent).toContain(ctx.traceId);
      expect(ctx.traceparent).toContain(ctx.spanId);
    });

    it('should reuse a valid traceId when provided', () => {
      const existingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const ctx = createTraceContext(existingTraceId);
      expect(ctx.traceId).toBe(existingTraceId);
      expect(isValidSpanId(ctx.spanId)).toBe(true);
    });

    it('should reuse both traceId and spanId when both are valid', () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const spanId = '00f067aa0ba902b7';
      const ctx = createTraceContext(traceId, spanId);
      expect(ctx.traceId).toBe(traceId);
      expect(ctx.spanId).toBe(spanId);
    });

    it('should generate new traceId when provided one is invalid', () => {
      const ctx = createTraceContext('invalid');
      expect(isValidTraceId(ctx.traceId)).toBe(true);
      expect(ctx.traceId).not.toBe('invalid');
    });

    it('should generate new spanId when provided one is invalid', () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const ctx = createTraceContext(traceId, 'bad');
      expect(ctx.traceId).toBe(traceId);
      expect(isValidSpanId(ctx.spanId)).toBe(true);
      expect(ctx.spanId).not.toBe('bad');
    });

    it('should generate new traceId when all-zeros is provided', () => {
      const ctx = createTraceContext('0'.repeat(32));
      expect(ctx.traceId).not.toBe('0'.repeat(32));
      expect(isValidTraceId(ctx.traceId)).toBe(true);
    });

    it('should generate new spanId when all-zeros is provided', () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const ctx = createTraceContext(traceId, '0'.repeat(16));
      expect(ctx.traceId).toBe(traceId);
      expect(ctx.spanId).not.toBe('0'.repeat(16));
      expect(isValidSpanId(ctx.spanId)).toBe(true);
    });
  });

  describe('parseTraceparent', () => {
    it('should parse a valid traceparent header', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const ctx = parseTraceparent(header);
      expect(ctx).not.toBeNull();
      if (!ctx) return;
      expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(ctx.spanId).toBe('00f067aa0ba902b7');
      expect(ctx.traceparent).toBe(header);
    });

    it('should parse traceparent with flags 00 (not sampled)', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00';
      const ctx = parseTraceparent(header);
      expect(ctx).not.toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseTraceparent('')).toBeNull();
    });

    it('should return null for invalid format', () => {
      expect(parseTraceparent('not-a-traceparent')).toBeNull();
    });

    it('should return null for missing fields', () => {
      expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736')).toBeNull();
    });

    it('should return null when traceId is all-zeros', () => {
      const header = `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`;
      expect(parseTraceparent(header)).toBeNull();
    });

    it('should return null when spanId is all-zeros', () => {
      const header = `00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`;
      expect(parseTraceparent(header)).toBeNull();
    });

    it('should return null for uppercase hex', () => {
      expect(parseTraceparent('00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01')).toBeNull();
    });
  });
});
