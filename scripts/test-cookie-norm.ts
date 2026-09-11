import { normalizeCookieBlob } from '../server/providers/cookieUtils.js';
import fs from 'fs';
const blob = fs.readFileSync(process.env.TEMP + '/oai-blob.txt', 'utf8');
const result = normalizeCookieBlob(blob);
console.log('providerHint:', result.providerHint);
console.log('reassembled:', result.reassembledSplitToken, '| dropped:', result.droppedCount);
console.log('notes:', result.notes.join(' '));
console.log('clean cookie keys:', result.cookie.split(';').map((p) => p.trim().split('=')[0]).join(', '));
console.log('clean length:', result.cookie.length);
