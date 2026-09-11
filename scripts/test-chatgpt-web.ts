import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { chatgptWebProvider } from '../server/providers/chatgptWebProvider.js';

const dbPath = path.join(os.homedir(), '.sutra', 'sutra.db');
let cookie: string | undefined;
try {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT api_key FROM providers WHERE id = 'chatgpt-web'").get() as any;
  cookie = row?.api_key;
  console.log('Stored cookie exists:', Boolean(cookie), 'Length:', cookie?.length);
} catch (err: any) {
  console.log('Database read error:', err.message);
}

async function testWeb() {
  if (!cookie) {
    console.log('No cookie stored in database for chatgpt-web');
    return;
  }
  try {
    const generator = chatgptWebProvider.streamConversation({
      cookieString: cookie,
      messages: [{ role: 'user', content: 'Say "ChatGPT Cookie is live!"' }],
      model: 'auto',
    });
    for await (const chunk of generator) {
      console.log('CHUNK:', JSON.stringify(chunk));
    }
  } catch (err: any) {
    console.error('chatgptWeb error:', err.message, err.stack);
  }
}

testWeb().catch(console.error);
