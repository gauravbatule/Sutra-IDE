import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resilientFetch, isTlsCertificateError, getTlsFallbackAgent } from '../../server/tlsFetch.js';

describe('Omnicraft IDE — Resilient TLS Fetch & Certificate Fallback', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('isTlsCertificateError', () => {
    it('detects standard Node TLS certificate error codes', () => {
      expect(isTlsCertificateError({ cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } })).toBe(true);
      expect(isTlsCertificateError({ cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } })).toBe(true);
      expect(isTlsCertificateError({ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } })).toBe(true);
      expect(isTlsCertificateError({ cause: { code: 'CERT_HAS_EXPIRED' } })).toBe(true);
      expect(isTlsCertificateError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' })).toBe(true);
    });

    it('detects certificate error messages', () => {
      expect(isTlsCertificateError(new Error('unable to verify the first certificate'))).toBe(true);
      expect(isTlsCertificateError({ message: 'fetch failed', cause: new Error('unable to verify the first certificate') })).toBe(true);
      expect(isTlsCertificateError({ message: 'self-signed certificate in certificate chain' })).toBe(true);
    });

    it('returns false for non-certificate errors', () => {
      expect(isTlsCertificateError(null)).toBe(false);
      expect(isTlsCertificateError(undefined)).toBe(false);
      expect(isTlsCertificateError(new Error('ECONNREFUSED'))).toBe(false);
      expect(isTlsCertificateError(new Error('AbortError'))).toBe(false);
      expect(isTlsCertificateError(new Error('HTTP 401: Unauthorized'))).toBe(false);
      expect(isTlsCertificateError({ cause: { code: 'ETIMEDOUT' } })).toBe(false);
    });
  });

  describe('getTlsFallbackAgent', () => {
    it('returns a singleton Agent with rejectUnauthorized: false', () => {
      const agent1 = getTlsFallbackAgent();
      const agent2 = getTlsFallbackAgent();
      expect(agent1).toBeDefined();
      expect(agent1).toBe(agent2);
    });
  });

  describe('resilientFetch', () => {
    it('returns standard fetch response when request succeeds', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

      const res = await resilientFetch('https://api.example.com/v1/models');
      expect(res.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('automatically retries with TLS fallback dispatcher when encountering leaf cert error', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
        callCount++;
        if (callCount === 1) {
          const err = new TypeError('fetch failed');
          (err as any).cause = { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' };
          throw err;
        }
        // Second call should have dispatcher configured
        expect(init?.dispatcher).toBeDefined();
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      const res = await resilientFetch('https://api.sarvam.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      expect(callCount).toBe(2);
    });

    it('does not retry and rethrows non-certificate errors', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        throw new Error('ECONNRESET');
      });

      await expect(resilientFetch('https://api.example.com')).rejects.toThrow('ECONNRESET');
      expect(callCount).toBe(1);
    });
  });
});
