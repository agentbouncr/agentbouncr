import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { PolicyEngine } from '@agentbouncr/core';
import type { Policy, EvaluateRequest } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

function createEngine(): PolicyEngine {
  return new PolicyEngine(silentLogger);
}

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    name: 'test-policy',
    version: '1.0',
    rules: [
      { tool: 'file_read', effect: 'allow' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<EvaluateRequest>): EvaluateRequest {
  return {
    agentId: 'test-agent',
    tool: 'file_read',
    ...overrides,
  };
}

describe('PolicyEngine', () => {
  const engine = createEngine();

  describe('evaluate — basic', () => {
    it('should allow when matching allow rule exists', () => {
      const policy = makePolicy({
        rules: [{ tool: 'file_read', effect: 'allow' }],
      });
      const result = engine.evaluate(makeRequest(), policy);
      expect(result.allowed).toBe(true);
    });

    it('should deny when matching deny rule exists', () => {
      const policy = makePolicy({
        rules: [{ tool: 'file_read', effect: 'deny', reason: 'No reads' }],
      });
      const result = engine.evaluate(makeRequest(), policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('No reads');
    });

    it('should include traceId in result', () => {
      const result = engine.evaluate(makeRequest(), makePolicy());
      expect(result.traceId).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should use provided traceId when available', () => {
      const result = engine.evaluate(
        makeRequest({ traceId: 'aaaabbbbccccdddd1111222233334444' }),
        makePolicy(),
      );
      expect(result.traceId).toBe('aaaabbbbccccdddd1111222233334444');
    });

    it('should generate traceId when not provided', () => {
      const r1 = engine.evaluate(makeRequest(), makePolicy());
      const r2 = engine.evaluate(makeRequest(), makePolicy());
      expect(r1.traceId).toMatch(/^[a-f0-9]{32}$/);
      expect(r1.traceId).not.toBe(r2.traceId);
    });
  });

  describe('evaluate — no policy (fail-secure)', () => {
    it('should deny when policy is null', () => {
      const result = engine.evaluate(makeRequest(), null);
      expect(result.allowed).toBe(false);
    });

    it('should deny when policy is undefined', () => {
      const result = engine.evaluate(makeRequest(), undefined as unknown as Policy);
      expect(result.allowed).toBe(false);
    });

    it('should include reason mentioning agent', () => {
      const result = engine.evaluate(makeRequest({ agentId: 'my-agent' }), null);
      expect(result.reason).toContain('my-agent');
    });
  });

  describe('evaluate — no matching rules (fail-secure)', () => {
    it('should deny when no rules match the tool', () => {
      const policy = makePolicy({
        rules: [{ tool: 'file_write', effect: 'allow' }],
      });
      const result = engine.evaluate(makeRequest({ tool: 'file_read' }), policy);
      expect(result.allowed).toBe(false);
    });

    it('should include reason mentioning tool and policy', () => {
      const policy = makePolicy({
        name: 'my-policy',
        rules: [{ tool: 'other_tool', effect: 'allow' }],
      });
      const result = engine.evaluate(makeRequest({ tool: 'file_read' }), policy);
      expect(result.reason).toContain('file_read');
      expect(result.reason).toContain('my-policy');
    });
  });

  describe('evaluate — wildcard rules', () => {
    it('should match wildcard (*) rule when no specific rule exists', () => {
      const policy = makePolicy({
        rules: [{ tool: '*', effect: 'allow' }],
      });
      const result = engine.evaluate(makeRequest({ tool: 'any_tool' }), policy);
      expect(result.allowed).toBe(true);
    });

    it('should prefer specific tool rule over wildcard', () => {
      const policy = makePolicy({
        rules: [
          { tool: '*', effect: 'allow' },
          { tool: 'file_write', effect: 'deny', reason: 'No writes' },
        ],
      });
      const result = engine.evaluate(makeRequest({ tool: 'file_write' }), policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('No writes');
    });
  });

  describe('evaluate — priority ordering', () => {
    it('should prefer tool+condition over tool-only', () => {
      const policy = makePolicy({
        rules: [
          { tool: 'file_write', effect: 'allow' },
          {
            tool: 'file_write',
            effect: 'deny',
            condition: { path: { startsWith: '/etc/' } },
            reason: 'No /etc/ writes',
          },
        ],
      });
      const result = engine.evaluate(
        makeRequest({ tool: 'file_write', params: { path: '/etc/config' } }),
        policy,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('No /etc/ writes');
    });

    it('should prefer tool-only over wildcard', () => {
      const policy = makePolicy({
        rules: [
          { tool: '*', effect: 'deny', reason: 'Default deny' },
          { tool: 'file_read', effect: 'allow' },
        ],
      });
      const result = engine.evaluate(makeRequest({ tool: 'file_read' }), policy);
      expect(result.allowed).toBe(true);
    });

    it('should prefer deny over allow at equal specificity (fail-secure)', () => {
      const policy = makePolicy({
        rules: [
          { tool: 'file_write', effect: 'allow' },
          { tool: 'file_write', effect: 'deny', reason: 'Deny wins' },
        ],
      });
      const result = engine.evaluate(makeRequest({ tool: 'file_write' }), policy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Deny wins');
    });

    it('should allow when allow rule is more specific than deny rule', () => {
      const policy = makePolicy({
        rules: [
          { tool: '*', effect: 'deny', reason: 'Default deny' },
          {
            tool: 'file_read',
            effect: 'allow',
            condition: { path: { startsWith: '/tmp/' } },
          },
        ],
      });
      const result = engine.evaluate(
        makeRequest({ tool: 'file_read', params: { path: '/tmp/data.txt' } }),
        policy,
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny-before-allow at tool+condition specificity', () => {
      const policy = makePolicy({
        rules: [
          {
            tool: 'file_write',
            effect: 'allow',
            condition: { path: { startsWith: '/data/' } },
          },
          {
            tool: 'file_write',
            effect: 'deny',
            condition: { path: { startsWith: '/data/' } },
            reason: 'Condition-level deny wins',
          },
        ],
      });
      const result = engine.evaluate(
        makeRequest({ tool: 'file_write', params: { path: '/data/file.csv' } }),
        policy,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Condition-level deny wins');
    });
  });

  describe('evaluate — condition evaluation', () => {
    it('should deny when condition does not match', () => {
      const policy = makePolicy({
        rules: [
          {
            tool: 'file_write',
            effect: 'allow',
            condition: { path: { startsWith: '/tmp/' } },
          },
        ],
      });
      const result = engine.evaluate(
        makeRequest({ tool: 'file_write', params: { path: '/etc/passwd' } }),
        policy,
      );
      expect(result.allowed).toBe(false);
    });

    it('should allow when condition matches', () => {
      const policy = makePolicy({
        rules: [
          {
            tool: 'file_write',
            effect: 'allow',
            condition: { path: { startsWith: '/tmp/' } },
          },
        ],
      });
      const result = engine.evaluate(
        makeRequest({ tool: 'file_write', params: { path: '/tmp/output.txt' } }),
        policy,
      );
      expect(result.allowed).toBe(true);
    });

    it('should handle complex condition with multiple operators', () => {
      const policy = makePolicy({
        rules: [
          {
            tool: 'approve_payment',
            effect: 'deny',
            condition: { amount: { gt: 10000 } },
            reason: 'Amount too high',
          },
          {
            tool: 'approve_payment',
            effect: 'allow',
          },
        ],
      });
      // Under limit — allow
      const r1 = engine.evaluate(
        makeRequest({ tool: 'approve_payment', params: { amount: 5000 } }),
        policy,
      );
      expect(r1.allowed).toBe(true);

      // Over limit — deny (condition rule is more specific)
      const r2 = engine.evaluate(
        makeRequest({ tool: 'approve_payment', params: { amount: 15000 } }),
        policy,
      );
      expect(r2.allowed).toBe(false);
      expect(r2.reason).toBe('Amount too high');
    });
  });

  describe('evaluate — missing params with condition', () => {
    it('should not match condition-based rule when request has no params', () => {
      const policy = makePolicy({
        rules: [
          {
            tool: 'file_write',
            effect: 'allow',
            condition: { path: { startsWith: '/tmp/' } },
          },
        ],
      });
      const result = engine.evaluate(makeRequest({ tool: 'file_write' }), policy);
      expect(result.allowed).toBe(false);
    });
  });

  describe('evaluate — rule order independence', () => {
    it('should produce same result regardless of rule order in array', () => {
      const rulesAB = [
        { tool: 'file_write' as const, effect: 'allow' as const },
        { tool: 'file_write' as const, effect: 'deny' as const, reason: 'Deny wins' },
      ];
      const rulesBA = [rulesAB[1], rulesAB[0]];

      const r1 = engine.evaluate(makeRequest({ tool: 'file_write' }), makePolicy({ rules: rulesAB }));
      const r2 = engine.evaluate(makeRequest({ tool: 'file_write' }), makePolicy({ rules: rulesBA }));
      expect(r1.allowed).toBe(r2.allowed);
      expect(r1.allowed).toBe(false);
    });
  });

  describe('evaluate — appliedRules', () => {
    it('should return all matching rules in priority order', () => {
      const policy = makePolicy({
        name: 'multi-rule-policy',
        rules: [
          { tool: '*', effect: 'allow', name: 'wildcard-allow' },
          { tool: 'file_read', effect: 'allow', name: 'specific-allow' },
        ],
      });
      const result = engine.evaluate(makeRequest(), policy);
      expect(result.appliedRules).toHaveLength(2);
      expect(result.appliedRules[0].ruleName).toBe('specific-allow');
      expect(result.appliedRules[0].effect).toBe('allow');
      expect(result.appliedRules[1].ruleName).toBe('wildcard-allow');
    });

    it('should include policyName in appliedRules', () => {
      const policy = makePolicy({ name: 'my-policy' });
      const result = engine.evaluate(makeRequest(), policy);
      expect(result.appliedRules[0].policyName).toBe('my-policy');
    });

    it('should return empty appliedRules when no rules match', () => {
      const policy = makePolicy({
        rules: [{ tool: 'other_tool', effect: 'allow' }],
      });
      const result = engine.evaluate(makeRequest(), policy);
      expect(result.appliedRules).toHaveLength(0);
    });
  });

  describe('evaluate — fail-secure on error', () => {
    it('should deny when policy has corrupted rules', () => {
      const corruptPolicy = {
        name: 'corrupt',
        version: '1.0',
        rules: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as unknown as Policy;

      const result = engine.evaluate(makeRequest(), corruptPolicy);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Policy evaluation failed');
    });
  });

  describe('evaluate — rateLimit and requireApproval stubs', () => {
    it('should not reject based on rateLimit (Stufe 2 stub)', () => {
      const policy = makePolicy({
        rules: [
          { tool: 'web_search', effect: 'allow', rateLimit: { maxPerMinute: 10 } },
        ],
      });
      const result = engine.evaluate(makeRequest({ tool: 'web_search' }), policy);
      expect(result.allowed).toBe(true);
    });

    it('should not reject based on requireApproval (Stufe 2 stub)', () => {
      const policy = makePolicy({
        rules: [
          { tool: 'file_delete', effect: 'allow', requireApproval: true },
        ],
      });
      const result = engine.evaluate(makeRequest({ tool: 'file_delete' }), policy);
      expect(result.allowed).toBe(true);
    });

    it('should surface requireApproval in appliedRules', () => {
      const policy = makePolicy({
        rules: [
          { tool: 'file_delete', effect: 'allow', requireApproval: true },
        ],
      });
      const result = engine.evaluate(makeRequest({ tool: 'file_delete' }), policy);
      expect(result.appliedRules[0].requireApproval).toBe(true);
    });

    it('should leave requireApproval undefined when not set', () => {
      const policy = makePolicy({
        rules: [{ tool: 'file_read', effect: 'allow' }],
      });
      const result = engine.evaluate(makeRequest(), policy);
      expect(result.appliedRules[0].requireApproval).toBeUndefined();
    });

    it('should surface requireApproval on deny rules too', () => {
      const policy = makePolicy({
        rules: [
          { tool: 'file_read', effect: 'deny', requireApproval: true },
        ],
      });
      const result = engine.evaluate(makeRequest(), policy);
      expect(result.appliedRules[0].requireApproval).toBe(true);
      expect(result.allowed).toBe(false);
    });
  });

  describe('DI verification', () => {
    it('should be instantiable with injected logger', () => {
      const instance = new PolicyEngine(silentLogger);
      expect(instance).toBeDefined();
    });

    it('should work independently per instance', () => {
      const engine1 = new PolicyEngine(silentLogger);
      const engine2 = new PolicyEngine(silentLogger);
      const policy = makePolicy({
        rules: [{ tool: 'file_read', effect: 'deny', reason: 'Denied' }],
      });
      const r1 = engine1.evaluate(makeRequest(), policy);
      const r2 = engine2.evaluate(makeRequest(), policy);
      expect(r1.allowed).toBe(false);
      expect(r2.allowed).toBe(false);
    });
  });

  describe('deterministic behavior', () => {
    it('should return same result for same input', () => {
      const policy = makePolicy({
        rules: [
          { tool: '*', effect: 'deny' },
          { tool: 'file_read', effect: 'allow' },
          {
            tool: 'file_read',
            effect: 'deny',
            condition: { path: { startsWith: '/etc/' } },
          },
        ],
      });
      const request = makeRequest({
        tool: 'file_read',
        params: { path: '/tmp/file' },
        traceId: 'aaaabbbbccccdddd1111222233334444',
      });
      const r1 = engine.evaluate(request, policy);
      const r2 = engine.evaluate(request, policy);
      expect(r1.allowed).toBe(r2.allowed);
      expect(r1.reason).toBe(r2.reason);
      expect(r1.appliedRules).toEqual(r2.appliedRules);
    });
  });
});
