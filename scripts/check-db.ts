import Database from 'better-sqlite3';
import path from 'path';

const candidatePaths = [
  './sutra.db',
  'C:\\Users\\Gaurav Batule\\AppData\\Local\\Programs\\SUTRA IDE\\sutra.db',
  'C:\\Users\\Gaurav Batule\\AppData\\Roaming\\SUTRA IDE\\sutra.db'
];

for (const p of candidatePaths) {
  try {
    const db = new Database(p, { readonly: true });
    const rows = db.prepare('SELECT id, name, api_key FROM providers').all();
    console.log(`DB at ${p} has ${rows.length} providers:`);
    for (const r of rows) {
      if (r.api_key) {
        console.log(`  - ${r.id} (${r.name}): key/cookie length = ${r.api_key.length}`);
      }
    }
  } catch (err: any) {
    console.log(`DB at ${p}: ${err.message}`);
  }
}
