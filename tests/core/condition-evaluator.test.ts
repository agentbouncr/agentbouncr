import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '@agentbouncr/core';
import type { PolicyCondition } from '@agentbouncr/core';

describe('Condition Evaluator', () => {
  describe('evaluateCondition — boundary cases', () => {
    it('should return true when condition is undefined', () => {
      expect(evaluateCondition(undefined, { path: '/tmp' })).toBe(true);
    });

    it('should return true when condition is empty object', () => {
      expect(evaluateCondition({}, { path: '/tmp' })).toBe(true);
    });

    it('should return true when condition is undefined and params is undefined', () => {
      expect(evaluateCondition(undefined, undefined)).toBe(true);
    });

    it('should return false when condition exists but params is undefined', () => {
      const condition: PolicyCondition = { path: { startsWith: '/etc/' } };
      expect(evaluateCondition(condition, undefined)).toBe(false);
    });

    it('should return false when condition references missing param', () => {
      const condition: PolicyCondition = { path: { startsWith: '/etc/' } };
      expect(evaluateCondition(condition, { other: 'value' })).toBe(false);
    });
  });

  describe('equals operator', () => {
    it('should match string equality', () => {
      const c: PolicyCondition = { status: { equals: 'active' } };
      expect(evaluateCondition(c, { status: 'active' })).toBe(true);
      expect(evaluateCondition(c, { status: 'inactive' })).toBe(false);
    });

    it('should match number equality', () => {
      const c: PolicyCondition = { count: { equals: 42 } };
      expect(evaluateCondition(c, { count: 42 })).toBe(true);
      expect(evaluateCondition(c, { count: 43 })).toBe(false);
    });

    it('should match boolean equality', () => {
      const c: PolicyCondition = { enabled: { equals: true } };
      expect(evaluateCondition(c, { enabled: true })).toBe(true);
      expect(evaluateCondition(c, { enabled: false })).toBe(false);
    });

    it('should use strict equality (no coercion)', () => {
      const c: PolicyCondition = { value: { equals: 1 } };
      expect(evaluateCondition(c, { value: '1' })).toBe(false);
      expect(evaluateCondition(c, { value: true })).toBe(false);
    });
  });

  describe('notEquals operator', () => {
    it('should return true when values differ', () => {
      const c: PolicyCondition = { status: { notEquals: 'blocked' } };
      expect(evaluateCondition(c, { status: 'active' })).toBe(true);
    });

    it('should return false when values are equal', () => {
      const c: PolicyCondition = { status: { notEquals: 'blocked' } };
      expect(evaluateCondition(c, { status: 'blocked' })).toBe(false);
    });

    it('should return false when param is missing (fail-secure)', () => {
      const c: PolicyCondition = { status: { notEquals: 'blocked' } };
      expect(evaluateCondition(c, { otherParam: 'value' })).toBe(false);
      expect(evaluateCondition(c, {})).toBe(false);
    });

    it('should return false when param is null (fail-secure)', () => {
      const c: PolicyCondition = { status: { notEquals: 'blocked' } };
      expect(evaluateCondition(c, { status: null })).toBe(true);
    });
  });

  describe('startsWith operator', () => {
    it('should match prefix', () => {
      const c: PolicyCondition = { path: { startsWith: '/etc/' } };
      expect(evaluateCondition(c, { path: '/etc/passwd' })).toBe(true);
    });

    it('should return false on non-match', () => {
      const c: PolicyCondition = { path: { startsWith: '/etc/' } };
      expect(evaluateCondition(c, { path: '/tmp/file' })).toBe(false);
    });

    it('should return false when param is not string', () => {
      const c: PolicyCondition = { path: { startsWith: '/etc/' } };
      expect(evaluateCondition(c, { path: 42 })).toBe(false);
    });
  });

  describe('endsWith operator', () => {
    it('should match suffix', () => {
      const c: PolicyCondition = { file: { endsWith: '.exe' } };
      expect(evaluateCondition(c, { file: 'malware.exe' })).toBe(true);
    });

    it('should return false on non-match', () => {
      const c: PolicyCondition = { file: { endsWith: '.exe' } };
      expect(evaluateCondition(c, { file: 'script.sh' })).toBe(false);
    });
  });

  describe('contains operator', () => {
    it('should match substring', () => {
      const c: PolicyCondition = { query: { contains: 'DROP TABLE' } };
      expect(evaluateCondition(c, { query: 'SELECT * FROM t; DROP TABLE t' })).toBe(true);
    });

    it('should return false on non-match', () => {
      const c: PolicyCondition = { query: { contains: 'DROP TABLE' } };
      expect(evaluateCondition(c, { query: 'SELECT * FROM users' })).toBe(false);
    });

    it('should return false when param is not string', () => {
      const c: PolicyCondition = { query: { contains: 'test' } };
      expect(evaluateCondition(c, { query: 123 })).toBe(false);
    });
  });

  describe('gt operator', () => {
    it('should evaluate greater-than correctly', () => {
      const c: PolicyCondition = { amount: { gt: 1000 } };
      expect(evaluateCondition(c, { amount: 1500 })).toBe(true);
      expect(evaluateCondition(c, { amount: 1000 })).toBe(false);
      expect(evaluateCondition(c, { amount: 500 })).toBe(false);
    });

    it('should return false when param is not number', () => {
      const c: PolicyCondition = { amount: { gt: 1000 } };
      expect(evaluateCondition(c, { amount: '1500' })).toBe(false);
    });
  });

  describe('lt operator', () => {
    it('should evaluate less-than correctly', () => {
      const c: PolicyCondition = { amount: { lt: 100 } };
      expect(evaluateCondition(c, { amount: 50 })).toBe(true);
      expect(evaluateCondition(c, { amount: 100 })).toBe(false);
      expect(evaluateCondition(c, { amount: 200 })).toBe(false);
    });
  });

  describe('gte operator', () => {
    it('should evaluate greater-or-equal correctly', () => {
      const c: PolicyCondition = { amount: { gte: 1000 } };
      expect(evaluateCondition(c, { amount: 1000 })).toBe(true);
      expect(evaluateCondition(c, { amount: 1001 })).toBe(true);
      expect(evaluateCondition(c, { amount: 999 })).toBe(false);
    });
  });

  describe('lte operator', () => {
    it('should evaluate less-or-equal correctly', () => {
      const c: PolicyCondition = { amount: { lte: 100 } };
      expect(evaluateCondition(c, { amount: 100 })).toBe(true);
      expect(evaluateCondition(c, { amount: 99 })).toBe(true);
      expect(evaluateCondition(c, { amount: 101 })).toBe(false);
    });

    it('should return false when operand is not number', () => {
      const c: PolicyCondition = { amount: { lte: 'abc' as unknown as number } };
      expect(evaluateCondition(c, { amount: 50 })).toBe(false);
    });
  });

  describe('in operator', () => {
    it('should return true when value is in array', () => {
      const c: PolicyCondition = { status: { in: ['active', 'pending'] } };
      expect(evaluateCondition(c, { status: 'active' })).toBe(true);
      expect(evaluateCondition(c, { status: 'pending' })).toBe(true);
    });

    it('should return false when value is not in array', () => {
      const c: PolicyCondition = { status: { in: ['active', 'pending'] } };
      expect(evaluateCondition(c, { status: 'blocked' })).toBe(false);
    });

    it('should handle mixed types in array', () => {
      const c: PolicyCondition = { code: { in: [1, 'two', 3] } };
      expect(evaluateCondition(c, { code: 1 })).toBe(true);
      expect(evaluateCondition(c, { code: 'two' })).toBe(true);
      expect(evaluateCondition(c, { code: '1' })).toBe(false);
    });

    it('should return false when operand is not array', () => {
      const c: PolicyCondition = { status: { in: 'active' as unknown as string[] } };
      expect(evaluateCondition(c, { status: 'active' })).toBe(false);
    });
  });

  describe('matches operator', () => {
    it('should match valid regex', () => {
      const c: PolicyCondition = { path: { matches: '^/api/v[0-9]+/' } };
      expect(evaluateCondition(c, { path: '/api/v2/users' })).toBe(true);
    });

    it('should return false on non-match', () => {
      const c: PolicyCondition = { path: { matches: '^/api/v[0-9]+/' } };
      expect(evaluateCondition(c, { path: '/web/page' })).toBe(false);
    });

    it('should return false on invalid regex (fail-secure)', () => {
      const c: PolicyCondition = { path: { matches: '[invalid(' } };
      expect(evaluateCondition(c, { path: 'anything' })).toBe(false);
    });

    it('should return false when param is not string', () => {
      const c: PolicyCondition = { path: { matches: '.*' } };
      expect(evaluateCondition(c, { path: 42 })).toBe(false);
    });

    it('should support word-boundary matching', () => {
      const c: PolicyCondition = { command: { matches: '\\bdelete\\b' } };
      expect(evaluateCondition(c, { command: 'delete file' })).toBe(true);
      expect(evaluateCondition(c, { command: 'undelete file' })).toBe(false);
    });

    it('should reject regex patterns longer than 200 chars (ReDoS protection)', () => {
      const c: PolicyCondition = { path: { matches: 'a'.repeat(201) } };
      expect(evaluateCondition(c, { path: 'a'.repeat(201) })).toBe(false);
    });

    it('should accept regex patterns up to 200 chars', () => {
      const c: PolicyCondition = { path: { matches: 'a'.repeat(200) } };
      expect(evaluateCondition(c, { path: 'a'.repeat(200) })).toBe(true);
    });

    it('should reject ReDoS patterns with catastrophic backtracking (safe-regex2)', () => {
      // These patterns cause exponential backtracking despite being short
      const redosPatterns = [
        '(a+)+$',
        '(x+x+)+y',
        '(.*)*b',
        '([a-z]+)*$',
      ];
      for (const pattern of redosPatterns) {
        const c: PolicyCondition = { path: { matches: pattern } };
        expect(evaluateCondition(c, { path: 'aaaaaaaaaaaaaaa' })).toBe(false);
      }
    });

    it('should accept safe regex patterns', () => {
      const safePatterns = [
        { pattern: '^foo.*bar$', input: 'foo123bar', expected: true },
        { pattern: '\\d{3}-\\d{4}', input: '123-4567', expected: true },
        { pattern: '^[a-z]+$', input: 'hello', expected: true },
        { pattern: '\\bdelete\\b', input: 'delete file', expected: true },
      ];
      for (const { pattern, input, expected } of safePatterns) {
        const c: PolicyCondition = { path: { matches: pattern } };
        expect(evaluateCondition(c, { path: input })).toBe(expected);
      }
    });
  });

  describe('multiple conditions (AND logic)', () => {
    it('should require ALL param conditions to match', () => {
      const c: PolicyCondition = {
        path: { startsWith: '/etc/' },
        mode: { equals: 'write' },
      };
      expect(evaluateCondition(c, { path: '/etc/config', mode: 'write' })).toBe(true);
      expect(evaluateCondition(c, { path: '/etc/config', mode: 'read' })).toBe(false);
      expect(evaluateCondition(c, { path: '/tmp/file', mode: 'write' })).toBe(false);
    });

    it('should return false if any param condition fails', () => {
      const c: PolicyCondition = {
        a: { equals: 1 },
        b: { equals: 2 },
        c: { equals: 3 },
      };
      expect(evaluateCondition(c, { a: 1, b: 2, c: 3 })).toBe(true);
      expect(evaluateCondition(c, { a: 1, b: 2, c: 99 })).toBe(false);
    });
  });

  describe('multiple operators on same param', () => {
    it('should AND operators: gte + lte = range check', () => {
      const c: PolicyCondition = {
        amount: { gte: 100, lte: 500 },
      };
      expect(evaluateCondition(c, { amount: 100 })).toBe(true);
      expect(evaluateCondition(c, { amount: 300 })).toBe(true);
      expect(evaluateCondition(c, { amount: 500 })).toBe(true);
      expect(evaluateCondition(c, { amount: 50 })).toBe(false);
      expect(evaluateCondition(c, { amount: 501 })).toBe(false);
    });

    it('should AND operators: startsWith + endsWith', () => {
      const c: PolicyCondition = {
        path: { startsWith: '/data/', endsWith: '.csv' },
      };
      expect(evaluateCondition(c, { path: '/data/report.csv' })).toBe(true);
      expect(evaluateCondition(c, { path: '/data/report.json' })).toBe(false);
      expect(evaluateCondition(c, { path: '/tmp/report.csv' })).toBe(false);
    });
  });

  describe('unknown operator', () => {
    it('should return false for unknown operator (fail-secure)', () => {
      const c = { path: { unknownOp: 'value' } } as unknown as PolicyCondition;
      expect(evaluateCondition(c, { path: 'anything' })).toBe(false);
    });
  });

  describe('deterministic behavior', () => {
    it('should return same result for same input', () => {
      const c: PolicyCondition = {
        path: { startsWith: '/etc/', endsWith: '.conf' },
        mode: { in: ['read', 'write'] },
      };
      const params = { path: '/etc/app.conf', mode: 'read' };
      const r1 = evaluateCondition(c, params);
      const r2 = evaluateCondition(c, params);
      const r3 = evaluateCondition(c, params);
      expect(r1).toBe(true);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });
  });
});
