import { describe, it, expect } from 'vitest';
import {
  locateAntigravityBinary,
  describeLocalAntigravitySignIn,
  hasLocalAntigravitySignIn,
  discoverAntigravityProxy,
  ensureAntigravityDaemonRunning,
} from '../../server/providers/antigravityBridge.js';

describe('Antigravity Auto-Proxy & Language Server Detection', () => {
  it('locates local antigravity binary or returns null safely', () => {
    const bin = locateAntigravityBinary();
    if (bin) {
      expect(typeof bin).toBe('string');
      expect(bin.toLowerCase()).toContain('language_server');
    } else {
      expect(bin).toBeNull();
    }
  });

  it('reports local sign in / daemon status accurately', () => {
    const hasSignIn = hasLocalAntigravitySignIn();
    expect(typeof hasSignIn).toBe('boolean');

    const desc = describeLocalAntigravitySignIn();
    expect(desc).toBeDefined();
    expect(typeof desc.available).toBe('boolean');
    expect(typeof desc.detail).toBe('string');
    expect(desc.detail.length).toBeGreaterThan(0);
  }, 20000);

  it('runs discoverAntigravityProxy and returns a valid status object or null', async () => {
    const proxy = await discoverAntigravityProxy();
    if (proxy) {
      expect(proxy.port).toBeGreaterThan(0);
      expect(typeof proxy.csrfToken).toBe('string');
      expect(proxy.pid).toBeGreaterThan(0);
    }
  }, 20000);

  it('ensures daemon is running or starts it cleanly', async () => {
    const proxy = await ensureAntigravityDaemonRunning();
    if (proxy) {
      expect(proxy.port).toBeGreaterThan(0);
      expect(typeof proxy.csrfToken).toBe('string');
      expect(proxy.pid).toBeGreaterThan(0);
    }
  }, 25000);
});
