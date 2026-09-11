import { modelRouter } from '../server/modelRouter.js';
await modelRouter.refreshRemoteModels();
const all = modelRouter.getAllModels();
const byProvider: Record<string, string[]> = {};
for (const m of all) {
  (byProvider[m.provider] = byProvider[m.provider] || []).push(m.id);
}
for (const p of ['google', 'groq', 'chatgpt-web']) {
  console.log(p + ':', (byProvider[p] || []).slice(0, 12).join(', ') || '(none)');
}
console.log('total models:', all.length, '| providers:', Object.keys(byProvider).length);
