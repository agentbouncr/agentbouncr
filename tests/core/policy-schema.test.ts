import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import {
  policySchema,
  policyRuleSchema,
  policyConditionSchema,
  validatePolicy,
} from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

const validPolicy = {
  name: 'test-policy',
  version: '1.0',
  rules: [
    { tool: 'file_read', effect: 'allow' },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('Policy Schema', () => {
  describe('policySchema', () => {
    it('should validate a complete valid policy', () => {
      const result = policySchema.safeParse({
        name: 'restrict-filesystem',
        version: '2.0',
        agentId: 'claims-agent',
        rules: [
          {
            name: 'deny-etc',
            tool: 'file_write',
            effect: 'deny',
            condition: { path: { startsWith: '/etc/' } },
            reason: 'No /etc/ writes',
            rateLimit: { maxPerMinute: 10 },
            requireApproval: true,
          },
        ],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('should validate a minimal valid policy', () => {
      const result = policySchema.safeParse(validPolicy);
      expect(result.success).toBe(true);
    });

    it('should reject missing name', () => {
      const { name: _, ...noName } = validPolicy;
      const result = policySchema.safeParse(noName);
      expect(result.success).toBe(false);
    });

    it('should reject missing version', () => {
      const { version: _, ...noVersion } = validPolicy;
      const result = policySchema.safeParse(noVersion);
      expect(result.success).toBe(false);
    });

    it('should reject empty rules array', () => {
      const result = policySchema.safeParse({ ...validPolicy, rules: [] });
      expect(result.success).toBe(false);
    });

    it('should reject missing rules', () => {
      const { rules: _, ...noRules } = validPolicy;
      const result = policySchema.safeParse(noRules);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const result = policySchema.safeParse({ ...validPolicy, name: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('policyRuleSchema', () => {
    it('should validate a rule with effect allow', () => {
      const result = policyRuleSchema.safeParse({ tool: 'file_read', effect: 'allow' });
      expect(result.success).toBe(true);
    });

    it('should validate a rule with effect deny', () => {
      const result = policyRuleSchema.safeParse({ tool: 'file_write', effect: 'deny' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid effect value', () => {
      const result = policyRuleSchema.safeParse({ tool: 'file_read', effect: 'block' });
      expect(result.success).toBe(false);
    });

    it('should validate a rule with condition', () => {
      const result = policyRuleSchema.safeParse({
        tool: 'file_write',
        effect: 'deny',
        condition: { path: { startsWith: '/etc/' } },
      });
      expect(result.success).toBe(true);
    });

    it('should validate a rule with rateLimit', () => {
      const result = policyRuleSchema.safeParse({
        tool: 'web_search',
        effect: 'allow',
        rateLimit: { maxPerMinute: 10 },
      });
      expect(result.success).toBe(true);
    });

    it('should reject rateLimit with non-positive value', () => {
      const result = policyRuleSchema.safeParse({
        tool: 'web_search',
        effect: 'allow',
        rateLimit: { maxPerMinute: 0 },
      });
      expect(result.success).toBe(false);
    });

    it('should validate a rule with requireApproval', () => {
      const result = policyRuleSchema.safeParse({
        tool: 'file_delete',
        effect: 'allow',
        requireApproval: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty tool name', () => {
      const result = policyRuleSchema.safeParse({ tool: '', effect: 'allow' });
      expect(result.success).toBe(false);
    });

    it('should accept wildcard tool', () => {
      const result = policyRuleSchema.safeParse({ tool: '*', effect: 'deny' });
      expect(result.success).toBe(true);
    });
  });

  describe('policyConditionSchema', () => {
    it('should validate condition with string operand', () => {
      const result = policyConditionSchema.safeParse({ path: { startsWith: '/etc/' } });
      expect(result.success).toBe(true);
    });

    it('should validate condition with number operand', () => {
      const result = policyConditionSchema.safeParse({ amount: { gt: 1000 } });
      expect(result.success).toBe(true);
    });

    it('should validate condition with array operand (in)', () => {
      const result = policyConditionSchema.safeParse({ status: { in: ['active', 'pending'] } });
      expect(result.success).toBe(true);
    });

    it('should validate condition with boolean operand', () => {
      const result = policyConditionSchema.safeParse({ enabled: { equals: true } });
      expect(result.success).toBe(true);
    });

    it('should validate condition with multiple operators', () => {
      const result = policyConditionSchema.safeParse({
        amount: { gte: 100, lte: 500 },
      });
      expect(result.success).toBe(true);
    });

    it('should validate condition with matches operator (regex string)', () => {
      const result = policyConditionSchema.safeParse({ path: { matches: '^/api/v[0-9]+/' } });
      expect(result.success).toBe(true);
    });

    it('should reject unknown operator names', () => {
      const result = policyConditionSchema.safeParse({ path: { startswith: '/etc/' } });
      expect(result.success).toBe(false);
    });
  });

  describe('validatePolicy — fail-secure', () => {
    it('should return validated policy on valid input', () => {
      const result = validatePolicy(validPolicy, silentLogger);
      expect(result.name).toBe('test-policy');
      expect(result.rules).toHaveLength(1);
    });

    it('should call process.exit(1) on invalid input', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      expect(() => validatePolicy({ invalid: true }, silentLogger)).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should log error with issues on invalid input', () => {
      const logSpy = vi.fn();
      const mockLogger = { error: logSpy } as unknown as pino.Logger;

      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      try {
        validatePolicy({}, mockLogger);
      } catch {
        // Expected
      }

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ errors: expect.any(Array) }),
        expect.stringContaining('Invalid policy'),
      );

      vi.restoreAllMocks();
    });
  });
});
