import { ensureFreshAccessToken } from '../server/providers/antigravityBridge.js';

const modelsToTest = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3.7-flash',
  'gemini-3-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-2.0-pro-exp-02-05',
  'claude-3-7-sonnet',
  'claude-3-5-sonnet',
  'claude-3-5-sonnet-v2@20241022',
  'claude-sonnet-4-6',
  'claude-3-5-haiku',
  'claude-opus-4-6-thinking'
];

async function probeCodeAssistModels() {
  const token = await ensureFreshAccessToken();
  if (!token) throw new Error('No token');
  
  const loadRes = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'antigravity/2.11.0 windows/x64',
      'X-Client-Name': 'antigravity',
      'X-Client-Version': '2.11.0',
    },
    body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY', ideVersion: '2.11.0' } })
  });
  const loadData: any = await loadRes.json();
  const project = loadData?.cloudaicompanionProject || loadData?.billingProject || 'projects/5860377056';
  console.log(`Using token and project: ${project}`);
  if (loadData?.models) {
    console.log('Available models from loadCodeAssist:', JSON.stringify(loadData.models, null, 2));
  }

  for (const m of modelsToTest) {
    const body = {
      model: m,
      project,
      request: {
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 5 }
      }
    };
    try {
      const res = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/2.11.0 windows/x64',
          'X-Client-Name': 'antigravity',
          'X-Client-Version': '2.11.0',
        },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      console.log(`[Model: ${m}] Status: ${res.status}, Response: ${text.slice(0, 120).replace(/\r?\n/g, ' ')}`);
    } catch (err: any) {
      console.log(`[Model: ${m}] Error: ${err.message}`);
    }
  }
}

probeCodeAssistModels().catch(console.error);
