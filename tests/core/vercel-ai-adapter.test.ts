import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import {
  wrapToolsWithGovernance,
  PolicyEngine,
  GovernanceEventEmitter,
  GovernanceError,
} from '@agentbouncr/core';
import type {
  AIToolSet,
  GovernanceWrapOptions,
  Policy,
} from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    name: 'test-policy',
    version: '1.0',
    rules: [
      { tool: 'allowed_tool', effect: 'allow' },
      { tool: 'denied_tool', effect: 'deny', reason: 'Not permitted' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeOptions(overrides?: Partial<GovernanceWrapOptions>): GovernanceWrapOptions {
  return {
    agentId: 'test-agent',
    policyEngine: new PolicyEngine(silentLogger),
    policy: makePolicy(),
    eventEmitter: new GovernanceEventEmitter(silentLogger),
    logger: silentLogger,
    ...overrides,
  };
}

describe('Vercel AI SDK Adapter', () => {
  describe('wrapToolsWithGovernance — basic', () => {
    it('should preserve tool description and parameters', () => {
      const tools: AIToolSet = {
        myTool: {
          description: 'Does something',
          parameters: { type: 'object' },
          execute: async () => 'result',
        },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());
      expect(wrapped.myTool.description).toBe('Does something');
      expect(wrapped.myTool.parameters).toEqual({ type: 'object' });
    });

    it('should return tool without execute unchanged', () => {
      const tools: AIToolSet = {
        descOnly: {
          description: 'Description only tool',
          parameters: { type: 'object' },
        },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());
      expect(wrapped.descOnly).toBe(tools.descOnly);
      expect(wrapped.descOnly.execute).toBeUndefined();
    });

    it('should wrap multiple tools', () => {
      const tools: AIToolSet = {
        a: { parameters: {}, execute: async () => 'a' },
        b: { parameters: {}, execute: async () => 'b' },
        c: { parameters: {}, description: 'no execute' },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());
      expect(Object.keys(wrapped)).toHaveLength(3);
      expect(wrapped.a.execute).toBeDefined();
      expect(wrapped.b.execute).toBeDefined();
      expect(wrapped.c.execute).toBeUndefined();
    });

    it('should return empty object for empty toolset', () => {
      const wrapped = wrapToolsWithGovernance({}, makeOptions());
      expect(wrapped).toEqual({});
    });
  });

  describe('wrapToolsWithGovernance — allow flow', () => {
    it('should call original execute when policy allows', async () => {
      const executeSpy = vi.fn().mockResolvedValue('success');
      const tools: AIToolSet = {
        allowed_tool: { parameters: {}, execute: executeSpy },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());
      const result = await wrapped.allowed_tool.execute?.({});
      expect(result).toBe('success');
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    it('should pass params to original execute', async () => {
      const executeSpy = vi.fn().mockResolvedValue('ok');
      const tools: AIToolSet = {
        allowed_tool: { parameters: {}, execute: executeSpy },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());
      await wrapped.allowed_tool.execute?.({ key: 'value' });
      expect(executeSpy).toHaveBeenCalledWith({ key: 'value' }, undefined);
    });

    it('should pass executeOptions to original execute', async () => {
      const executeSpy = vi.fn().mockResolvedValue('ok');
      const tools: AIToolSet = {
        allowed_tool: { parameters: {}, execute: executeSpy },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());
      const opts = { toolCallId: 'abc' };
      await wrapped.allowed_tool.execute?.({}, opts);
      expect(executeSpy).toHaveBeenCalledWith({}, opts);
    });
  });

  describe('wrapToolsWithGovernance — deny flow', () => {
    it('should throw GovernanceError when policy denies', async () => {
      const tools: AIToolSet = {
        denied_tool: { parameters: {}, execute: async () => 'should not run' },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());

      await expect(wrapped.denied_tool.execute?.({})).rejects.toThrow(GovernanceError);
    });

    it('should throw with code POLICY_DENIED', async () => {
      const tools: AIToolSet = {
        denied_tool: { parameters: {}, execute: async () => 'nope' },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());

      try {
        await wrapped.denied_tool.execute?.({});
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('POLICY_DENIED');
        expect((err as GovernanceError).category).toBe('policy_denial');
      }
    });

    it('should include reason from policy in error', async () => {
      const tools: AIToolSet = {
        denied_tool: { parameters: {}, execute: async () => 'nope' },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());

      try {
        await wrapped.denied_tool.execute?.({});
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as GovernanceError).message).toBe('Not permitted');
      }
    });

    it('should use fallback message when policy reason is undefined', async () => {
      const policy = makePolicy({
        rules: [{ tool: 'no_reason_tool', effect: 'deny' }],
      });
      const tools: AIToolSet = {
        no_reason_tool: { parameters: {}, execute: async () => 'nope' },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions({ policy }));

      try {
        await wrapped.no_reason_tool.execute?.({});
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as GovernanceError).message).toContain('no_reason_tool');
        expect((err as GovernanceError).message).toContain('denied by policy');
      }
    });

    it('should NOT call original execute on deny', async () => {
      const executeSpy = vi.fn().mockResolvedValue('should not run');
      const tools: AIToolSet = {
        denied_tool: { parameters: {}, execute: executeSpy },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());

      try { await wrapped.denied_tool.execute?.({}); } catch { /* expected */ }
      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  describe('wrapToolsWithGovernance — error handling', () => {
    it('should throw GovernanceError when execute throws', async () => {
      const tools: AIToolSet = {
        allowed_tool: {
          parameters: {},
          execute: async () => { throw new Error('Boom'); },
        },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());

      try {
        await wrapped.allowed_tool.execute?.({});
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GovernanceError);
        expect((err as GovernanceError).code).toBe('TOOL_EXECUTION_ERROR');
        expect((err as GovernanceError).category).toBe('tool_error');
        expect((err as GovernanceError).message).toBe('Tool execution failed');
        expect((err as GovernanceError).context?.originalError).toContain('Boom');
      }
    });
  });

  describe('wrapToolsWithGovernance — events', () => {
    let emitter: GovernanceEventEmitter;
    let options: GovernanceWrapOptions;

    beforeEach(() => {
      emitter = new GovernanceEventEmitter(silentLogger);
      options = makeOptions({ eventEmitter: emitter });
    });

    it('should emit tool_call.allowed event on allow', async () => {
      const events: unknown[] = [];
      emitter.on('tool_call.allowed', (event) => { events.push(event); });

      const tools: AIToolSet = {
        allowed_tool: { parameters: {}, execute: async () => 'ok' },
      };
      const wrapped = wrapToolsWithGovernance(tools, options);
      await wrapped.allowed_tool.execute?.({ key: 'val' });

      // Events are dispatched via process.nextTick, wait for them
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).type).toBe('tool_call.allowed');
    });

    it('should emit tool_call.denied event on deny', async () => {
      const events: unknown[] = [];
      emitter.on('tool_call.denied', (event) => { events.push(event); });

      const tools: AIToolSet = {
        denied_tool: { parameters: {}, execute: async () => 'nope' },
      };
      const wrapped = wrapToolsWithGovernance(tools, options);
      try { await wrapped.denied_tool.execute?.({}); } catch { /* expected */ }

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).type).toBe('tool_call.denied');
    });

    it('should emit tool_call.error event on execution error', async () => {
      const events: unknown[] = [];
      emitter.on('tool_call.error', (event) => { events.push(event); });

      const tools: AIToolSet = {
        allowed_tool: {
          parameters: {},
          execute: async () => { throw new Error('Fail'); },
        },
      };
      const wrapped = wrapToolsWithGovernance(tools, options);
      try { await wrapped.allowed_tool.execute?.({}); } catch { /* expected */ }

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).type).toBe('tool_call.error');
    });

    it('should include traceId in events', async () => {
      const events: unknown[] = [];
      emitter.on('tool_call.allowed', (event) => { events.push(event); });

      const tools: AIToolSet = {
        allowed_tool: { parameters: {}, execute: async () => 'ok' },
      };
      const wrapped = wrapToolsWithGovernance(tools, options);
      await wrapped.allowed_tool.execute?.({});

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.traceId).toBeDefined();
      expect(typeof event.traceId).toBe('string');
      expect((event.traceId as string).length).toBeGreaterThan(0);
    });

    it('should include agentId in events', async () => {
      const events: unknown[] = [];
      emitter.on('tool_call.allowed', (event) => { events.push(event); });

      const tools: AIToolSet = {
        allowed_tool: { parameters: {}, execute: async () => 'ok' },
      };
      const wrapped = wrapToolsWithGovernance(tools, options);
      await wrapped.allowed_tool.execute?.({});

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).agentId).toBe('test-agent');
    });

    it('should work without eventEmitter (optional)', async () => {
      const noEmitterOptions = makeOptions({ eventEmitter: undefined });
      const tools: AIToolSet = {
        allowed_tool: { parameters: {}, execute: async () => 'ok' },
      };
      const wrapped = wrapToolsWithGovernance(tools, noEmitterOptions);
      const result = await wrapped.allowed_tool.execute?.({});
      expect(result).toBe('ok');
    });
  });

  describe('wrapToolsWithGovernance — traceId in error context', () => {
    it('should include traceId in GovernanceError context on deny', async () => {
      const tools: AIToolSet = {
        denied_tool: { parameters: {}, execute: async () => 'nope' },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());

      try {
        await wrapped.denied_tool.execute?.({});
        expect.unreachable('Should have thrown');
      } catch (err) {
        const ctx = (err as GovernanceError).context;
        expect(ctx?.traceId).toBeDefined();
        expect(typeof ctx?.traceId).toBe('string');
        expect(ctx?.tool).toBe('denied_tool');
        expect(ctx?.agentId).toBe('test-agent');
      }
    });

    it('should include traceId in GovernanceError context on error', async () => {
      const tools: AIToolSet = {
        allowed_tool: {
          parameters: {},
          execute: async () => { throw new Error('Fail'); },
        },
      };
      const wrapped = wrapToolsWithGovernance(tools, makeOptions());

      try {
        await wrapped.allowed_tool.execute?.({});
        expect.unreachable('Should have thrown');
      } catch (err) {
        const ctx = (err as GovernanceError).context;
        expect(ctx?.traceId).toBeDefined();
        expect(ctx?.tool).toBe('allowed_tool');
      }
    });
  });

  describe('wrapToolsWithGovernance — policy evaluation', () => {
    it('should pass params to policy evaluation', async () => {
      const policy = makePolicy({
        rules: [
          {
            tool: 'file_write',
            effect: 'deny',
            condition: { path: { startsWith: '/etc/' } },
            reason: 'No /etc/ writes',
          },
          { tool: 'file_write', effect: 'allow' },
        ],
      });

      const tools: AIToolSet = {
        file_write: { parameters: {}, execute: async () => 'written' },
      };

      const wrapped = wrapToolsWithGovernance(tools, makeOptions({ policy }));

      // Allowed path
      const result = await wrapped.file_write.execute?.({ path: '/tmp/ok.txt' });
      expect(result).toBe('written');

      // Denied path
      await expect(
        wrapped.file_write.execute?.({ path: '/etc/passwd' }),
      ).rejects.toThrow('No /etc/ writes');
    });
  });
});
