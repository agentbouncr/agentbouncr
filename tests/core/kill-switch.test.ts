import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { KillSwitchManager, GovernanceEventEmitter } from '@agentbouncr/core';
import type { GovernanceEvent } from '@agentbouncr/core';

const silentLogger = pino({ level: 'silent' });

describe('KillSwitchManager', () => {
  let killSwitch: KillSwitchManager;

  beforeEach(() => {
    killSwitch = new KillSwitchManager(silentLogger);
  });

  describe('initial state', () => {
    it('should not be active by default', () => {
      expect(killSwitch.isActive()).toBe(false);
    });

    it('should return inactive status by default', () => {
      const status = killSwitch.getStatus();
      expect(status.active).toBe(false);
      expect(status.activatedAt).toBeUndefined();
      expect(status.reason).toBeUndefined();
    });
  });

  describe('activate()', () => {
    it('should set active to true', () => {
      killSwitch.activate('Emergency');
      expect(killSwitch.isActive()).toBe(true);
    });

    it('should store reason in status', () => {
      killSwitch.activate('Test emergency');
      const status = killSwitch.getStatus();
      expect(status.reason).toBe('Test emergency');
    });

    it('should store activatedAt timestamp', () => {
      killSwitch.activate('Emergency');
      const status = killSwitch.getStatus();
      expect(status.activatedAt).toBeDefined();
      expect(typeof status.activatedAt).toBe('string');
      // Should be a valid ISO timestamp
      const activatedAt = status.activatedAt ?? '';
      expect(new Date(activatedAt).toISOString()).toBe(activatedAt);
    });

    it('should be idempotent (second activate is no-op)', () => {
      killSwitch.activate('First');
      const status1 = killSwitch.getStatus();
      killSwitch.activate('Second');
      const status2 = killSwitch.getStatus();

      // Reason should still be from first activation
      expect(status2.reason).toBe('First');
      expect(status2.activatedAt).toBe(status1.activatedAt);
    });

    it('should emit killswitch.activated event', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);

      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.activated', (event) => { events.push(event); });

      ks.activate('Test reason');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('killswitch.activated');
      expect(events[0].data.reason).toBe('Test reason');
    });

    it('should NOT emit event on second activate (idempotent)', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);

      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.activated', (event) => { events.push(event); });

      ks.activate('First');
      ks.activate('Second');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
    });
  });

  describe('reset()', () => {
    it('should set active to false', () => {
      killSwitch.activate('Emergency');
      killSwitch.reset();
      expect(killSwitch.isActive()).toBe(false);
    });

    it('should clear reason and activatedAt', () => {
      killSwitch.activate('Emergency');
      killSwitch.reset();
      const status = killSwitch.getStatus();
      expect(status.reason).toBeUndefined();
      expect(status.activatedAt).toBeUndefined();
    });

    it('should be no-op when not active', () => {
      killSwitch.reset(); // should not throw
      expect(killSwitch.isActive()).toBe(false);
    });

    it('should allow re-activation after reset', () => {
      killSwitch.activate('First');
      killSwitch.reset();
      killSwitch.activate('Second');
      expect(killSwitch.isActive()).toBe(true);
      expect(killSwitch.getStatus().reason).toBe('Second');
    });

    it('should emit event on re-activation after reset', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);

      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.activated', (event) => { events.push(event); });

      ks.activate('First');
      ks.reset();
      ks.activate('Second');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(2);
    });
  });

  describe('without EventEmitter', () => {
    it('should work without EventEmitter (optional)', () => {
      const ks = new KillSwitchManager(silentLogger);
      ks.activate('Test');
      expect(ks.isActive()).toBe(true);
      ks.reset();
      expect(ks.isActive()).toBe(false);
    });
  });

  describe('tenant-scoped state', () => {
    it('should activate only the specified tenant', () => {
      killSwitch.activate('Emergency', 'tenant-a');
      expect(killSwitch.isActive('tenant-a')).toBe(true);
      expect(killSwitch.isActive('tenant-b')).toBe(false);
      expect(killSwitch.isActive()).toBe(false); // global unaffected
    });

    it('should allow independent activation for multiple tenants', () => {
      killSwitch.activate('Reason A', 'tenant-a');
      killSwitch.activate('Reason B', 'tenant-b');
      expect(killSwitch.isActive('tenant-a')).toBe(true);
      expect(killSwitch.isActive('tenant-b')).toBe(true);
      expect(killSwitch.getStatus('tenant-a').reason).toBe('Reason A');
      expect(killSwitch.getStatus('tenant-b').reason).toBe('Reason B');
    });

    it('should reset only the specified tenant', () => {
      killSwitch.activate('Reason A', 'tenant-a');
      killSwitch.activate('Reason B', 'tenant-b');
      killSwitch.reset('tenant-a');
      expect(killSwitch.isActive('tenant-a')).toBe(false);
      expect(killSwitch.isActive('tenant-b')).toBe(true);
    });

    it('should return tenant-specific status', () => {
      killSwitch.activate('Reason A', 'tenant-a');
      const statusA = killSwitch.getStatus('tenant-a');
      const statusB = killSwitch.getStatus('tenant-b');
      expect(statusA.active).toBe(true);
      expect(statusA.reason).toBe('Reason A');
      expect(statusA.activatedAt).toBeDefined();
      expect(statusB.active).toBe(false);
      expect(statusB.reason).toBeUndefined();
    });

    it('should emit event with tenantId in data', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);

      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.activated', (event) => { events.push(event); });

      ks.activate('Tenant emergency', 'tenant-a');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toBe('Tenant emergency');
      expect(events[0].data.tenantId).toBe('tenant-a');
      expect(events[0].tenantId).toBe('tenant-a');
    });

    it('should keep global state independent from tenant state', () => {
      killSwitch.activate('Global reason');
      expect(killSwitch.isActive()).toBe(true);
      expect(killSwitch.isActive('tenant-a')).toBe(false);

      killSwitch.activate('Tenant reason', 'tenant-a');
      expect(killSwitch.isActive()).toBe(true);
      expect(killSwitch.isActive('tenant-a')).toBe(true);

      killSwitch.reset(); // reset global
      expect(killSwitch.isActive()).toBe(false);
      expect(killSwitch.isActive('tenant-a')).toBe(true); // tenant unaffected
    });

    it('should be idempotent per tenant', () => {
      killSwitch.activate('First', 'tenant-a');
      const status1 = killSwitch.getStatus('tenant-a');
      killSwitch.activate('Second', 'tenant-a');
      const status2 = killSwitch.getStatus('tenant-a');
      expect(status2.reason).toBe('First');
      expect(status2.activatedAt).toBe(status1.activatedAt);
    });

    it('should NOT emit event on second tenant activate (idempotent)', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);

      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.activated', (event) => { events.push(event); });

      ks.activate('First', 'tenant-a');
      ks.activate('Second', 'tenant-a');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.tenantId).toBe('tenant-a');
    });

    it('should emit event on re-activation after tenant reset', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);

      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.activated', (event) => { events.push(event); });

      ks.activate('First', 'tenant-a');
      ks.reset('tenant-a');
      ks.activate('Second', 'tenant-a');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(2);
      expect(events[1].data.tenantId).toBe('tenant-a');
    });
  });

  describe('killswitch.deactivated events (F-02)', () => {
    it('should emit killswitch.deactivated event on global reset', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);
      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.deactivated', (event) => { events.push(event); });

      ks.activate('Incident');
      ks.reset(undefined, 'Resolved');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toBe('Resolved');
      expect(events[0].data.previousReason).toBe('Incident');
    });

    it('should emit default reason when none provided', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);
      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.deactivated', (event) => { events.push(event); });

      ks.activate('Test');
      ks.reset();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].data.reason).toBe('Manual reset');
    });

    it('should NOT emit killswitch.deactivated when not active', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);
      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.deactivated', (event) => { events.push(event); });

      ks.reset(undefined, 'Nothing to reset');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(0);
    });

    it('should emit killswitch.deactivated with tenantId on tenant reset', async () => {
      const emitter = new GovernanceEventEmitter(silentLogger);
      const ks = new KillSwitchManager(silentLogger, emitter);
      const events: GovernanceEvent[] = [];
      emitter.on('killswitch.deactivated', (event) => { events.push(event); });

      ks.activate('Tenant emergency', 'tenant-a');
      ks.reset('tenant-a', 'Tenant resolved');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      expect(events[0].tenantId).toBe('tenant-a');
      expect(events[0].data.previousReason).toBe('Tenant emergency');
      expect(events[0].data.reason).toBe('Tenant resolved');
    });
  });
});
