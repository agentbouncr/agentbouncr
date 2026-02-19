import { describe, it, expect } from 'vitest';
import { GovernanceError } from '@agentbouncr/core';
import type { FailureCategory } from '@agentbouncr/core';

describe('GovernanceError', () => {
  it('should extend Error', () => {
    const err = new GovernanceError('test', 'TEST_CODE', 'tool_error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GovernanceError);
  });

  it('should set name to GovernanceError', () => {
    const err = new GovernanceError('test', 'TEST_CODE', 'tool_error');
    expect(err.name).toBe('GovernanceError');
  });

  it('should store message, code, category', () => {
    const err = new GovernanceError(
      'Tool not permitted',
      'PERMISSION_DENIED',
      'policy_denial',
    );
    expect(err.message).toBe('Tool not permitted');
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.category).toBe('policy_denial');
  });

  it('should store optional context', () => {
    const ctx = { agentId: 'claims-agent', tool: 'approve_payment' };
    const err = new GovernanceError('denied', 'DENIED', 'policy_denial', ctx);
    expect(err.context).toEqual(ctx);
  });

  it('should have undefined context when not provided', () => {
    const err = new GovernanceError('test', 'TEST', 'tool_error');
    expect(err.context).toBeUndefined();
  });

  it('should produce a proper stack trace', () => {
    const err = new GovernanceError('stack test', 'STACK', 'config_error');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('stack test');
  });

  it('should support all 8 failure categories', () => {
    const categories: FailureCategory[] = [
      'tool_error',
      'policy_denial',
      'provider_timeout',
      'provider_error',
      'injection_alert',
      'config_error',
      'rate_limit',
      'approval_timeout',
    ];

    for (const category of categories) {
      const err = new GovernanceError('test', 'TEST', category);
      expect(err.category).toBe(category);
    }
  });
});
