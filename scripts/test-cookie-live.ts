import { normalizeCookieBlob } from '../server/providers/cookieUtils.js';
import Database from 'better-sqlite3';
const db = new Database('sutra.db', { readonly: true });
const row = db.prepare("SELECT cookie_data FROM providers WHERE id='openai'").get() as any;
const clean = normalizeCookieBlob(row.cookie_data);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const res = await fetch('https://chatgpt.com/api/auth/session', {
  headers: { Cookie: clean.cookie, 'User-Agent': UA },
  signal: AbortSignal.timeout(20000),
});
const body = await res.text();
const hasToken = body.includes('"accessToken"');
console.log('reassembled session:', res.status, '| has accessToken:', hasToken, '| body len:', body.length);
if (hasToken) {
  const parsed = JSON.parse(body);
  console.log('user:', parsed.user?.email ? '(email present)' : 'none', '| expires:', parsed.expires || 'none');
  // List models the session offers (names only)
  const modelsRes = await fetch('https://chatgpt.com/backend-api/models?history_and_training_models=false', {
    headers: { Cookie: clean.cookie, 'User-Agent': UA, Authorization: `Bearer ${parsed.accessToken}` },
    signal: AbortSignal.timeout(20000),
  });
  const mbody = await modelsRes.text();
  console.log('models endpoint:', modelsRes.status, '| has slug list:', mbody.includes('slug'));
}
