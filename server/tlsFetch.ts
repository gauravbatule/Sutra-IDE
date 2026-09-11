import { Agent } from 'undici';

let _tlsFallbackAgent: Agent | null = null;

export function getTlsFallbackAgent(): Agent {
  if (!_tlsFallbackAgent) {
    _tlsFallbackAgent = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    });
  }
  return _tlsFallbackAgent;
}

export function isTlsCertificateError(err: any): boolean {
  if (!err) return false;
  const code = String(err.cause?.code || err.code || '');
  const msg = `${err.message || ''} ${err.cause?.message || ''}`.toLowerCase();
  return (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS_') ||
    msg.includes('unable to verify the first certificate') ||
    msg.includes('self-signed certificate') ||
    msg.includes('certificate has expired') ||
    msg.includes('leaf signature') ||
    msg.includes('unable to verify')
  );
}

/**
 * Resilient fetch wrapper:
 * 1. Executes standard native fetch with strict TLS verification.
 * 2. If it encounters a certificate verification error (common on Windows with system CA store gaps,
 *    self-signed certificates on custom/local endpoints, or proxies), it automatically retries with
 *    a TLS fallback dispatcher.
 */
export async function resilientFetch(
  url: string | URL | Request,
  init?: RequestInit & { dispatcher?: any }
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: any) {
    if (isTlsCertificateError(err)) {
      const urlStr = typeof url === 'string' ? url : (url as any).url || 'endpoint';
      console.warn(`[TLS] Certificate error on "${urlStr}" (${err.cause?.code || err.message}). Retrying with TLS fallback agent...`);
      return await fetch(url, {
        ...init,
        dispatcher: getTlsFallbackAgent(),
      } as any);
    }
    throw err;
  }
}
