import Database from 'better-sqlite3';

const db = new Database('sutra.db', { readonly: true });
const rows = db.prepare('SELECT id, api_key, cookie_data FROM providers').all() as any[];
const get = (id: string) => rows.find((r) => r.id === id);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 1. Groq: which models does this key actually have?
const groq = get('groq');
if (groq?.api_key) {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${groq.api_key}` },
    signal: AbortSignal.timeout(15000),
  });
  const data: any = await res.json().catch(() => null);
  const ids: string[] = (data?.data || []).map((m: any) => m.id);
  console.log('groq models:', res.status, ids.length);
  console.log(ids.slice(0, 20).join(', '));
}

// 2. Google: which gemini models does this key support?
const google = get('google');
if (google?.api_key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${google.api_key}&pageSize=50`, {
    signal: AbortSignal.timeout(15000),
  });
  const data: any = await res.json().catch(() => null);
  const names: string[] = (data?.models || []).map((m: any) => String(m.name || '').replace('models/', ''));
  console.log('\ngoogle models:', res.status, names.length);
  console.log(names.filter((n) => /gemini/.test(n)).slice(0, 20).join(', '));
}

// 3. chatgpt-web: does the session JSON contain an accessToken anywhere?
const cw = get('chatgpt-web');
if (cw?.cookie_data) {
  const res = await fetch('https://chatgpt.com/api/auth/session', {
    headers: { Cookie: cw.cookie_data, 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  console.log('\nchatgpt-web: status', res.status, '| has accessToken field:', body.includes('accessToken'), '| body len:', body.length);
  console.log('cookie keys present:', cw.cookie_data.split(';').map((p: string) => p.trim().split('=')[0]).join(', '));
}

// 4. openai blob: what structure is it? (names only, no values)
const oa = get('openai');
if (oa) {
  const blob = oa.cookie_data || oa.api_key || '';
  console.log('\nopenai blob first 60 chars (structure):', JSON.stringify(blob.slice(0, 60)));
  const headerLike = /cookie|bearer|authorization|session|token/i.test(blob.slice(0, 200));
  console.log('looks like headers/labels:', headerLike);
  const pairs = blob.split(/[;\n]/).map((s: string) => s.trim().split('=')[0]).filter(Boolean);
  console.log('top-level key names:', pairs.slice(0, 25).join(', '));
}
