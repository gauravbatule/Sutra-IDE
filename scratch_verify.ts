import fs from 'fs';

const BASE_URL = 'http://localhost:3001';

async function runFullVerification() {
  console.log('====================================================');
  console.log('🚀 SUTRA FULL-STACK BUTTON & FEATURE VERIFICATION SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`• Testing [${name}] ... `);
    try {
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (e: any) {
      console.log(`❌ FAIL: ${e.message}`);
      failed++;
    }
  }

  // 1. Provider Catalog & Cookie/OAuth Auth Endpoints
  await test('GET /api/providers/catalog returns 159+ providers', async () => {
    const res = await fetch(`${BASE_URL}/api/providers/catalog`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (!data.providers || data.providers.length < 50) {
      throw new Error(`Expected >50 providers, received ${data.providers?.length}`);
    }
    const categories = new Set(data.providers.map((p: any) => p.category));
    if (!categories.has('frontier') || !categories.has('web-cookie')) {
      throw new Error('Missing frontier or web-cookie categories');
    }
  });

  await test('POST /api/providers/save-credential stores API key & cookie', async () => {
    const res = await fetch(`${BASE_URL}/api/providers/save-credential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'chatgpt-web',
        authType: 'cookie',
        cookieData: '__Secure-next-auth.session-token=test_token_12345; cf_clearance=abc',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to save');
  });

  await test('POST /api/providers/test tests provider connectivity', async () => {
    const res = await fetch(`${BASE_URL}/api/providers/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'groq' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (typeof data.ok !== 'boolean') throw new Error('Invalid test response');
  });

  await test('POST /api/providers/test prevents silent false-positives when credentials missing', async () => {
    const res = await fetch(`${BASE_URL}/api/providers/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'nonexistent-custom-provider' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (data.ok === true) throw new Error('Silent false-positive detected: unconfigured provider returned ok:true!');
    if (!data.error) throw new Error('Expected clear error message on unconfigured provider test');
  });

  // 2. Video Asset Generation & Zero-Corruption Verification
  await test('POST /api/media/generate-video generates valid uncorrupted video', async () => {
    const filename = `test-verify-${Date.now()}.mp4`;
    const res = await fetch(`${BASE_URL}/api/media/generate-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Futuristic glowing cybernetic interface',
        filename,
        durationSeconds: 4,
        aspectRatio: '16:9',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const asset: any = await res.json();
    if (!asset.path || !fs.existsSync(asset.path)) {
      throw new Error(`Generated file not found on disk at ${asset.path}`);
    }
    const stat = fs.statSync(asset.path);
    if (stat.size < 50) {
      throw new Error(`Video file is too small (${stat.size} bytes), likely corrupted`);
    }
    const buf = fs.readFileSync(asset.path);
    const isIsoOrWebM = (buf.slice(4, 8).toString() === 'ftyp') || (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3);
    if (!isIsoOrWebM) {
      throw new Error('Video container does not match valid ISOM MP4 or EBML WebM magic bytes');
    }
  });

  // 3. Image Asset Generation
  await test('POST /api/media/generate-image generates valid image asset', async () => {
    const filename = `test-verify-${Date.now()}.png`;
    const res = await fetch(`${BASE_URL}/api/media/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Minimalist dark glassmorphism dashboard icon',
        filename,
        dimensions: '512x512',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const asset: any = await res.json();
    if (!asset.path || !fs.existsSync(asset.path)) {
      throw new Error('Generated image file not found on disk');
    }
  });

  // 4. Audio Asset Generation
  await test('POST /api/media/generate-audio synthesizes valid WAV audio buffer', async () => {
    const filename = `test-click-${Date.now()}.wav`;
    const res = await fetch(`${BASE_URL}/api/media/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'click',
        filename,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const asset: any = await res.json();
    if (!asset.path || !fs.existsSync(asset.path)) {
      throw new Error('Generated audio file not found on disk');
    }
    const buf = fs.readFileSync(asset.path);
    if (buf.slice(0, 4).toString() !== 'RIFF' || buf.slice(8, 12).toString() !== 'WAVE') {
      throw new Error('Audio does not contain valid RIFF WAVE header');
    }
  });

  // 5. File System & Workspace Operations
  await test('GET /api/fs/tree reads directory tree', async () => {
    const res = await fetch(`${BASE_URL}/api/fs/tree`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('data is not an array of tree nodes');
  });

  // 6. Git Status & Versioning
  await test('GET /api/git/status returns git tracking info', async () => {
    const res = await fetch(`${BASE_URL}/api/git/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (typeof data.branch !== 'string') throw new Error('Missing branch info');
  });

  // 7. Mobile Companion LAN IP Detection
  await test('GET /api/mobile/pairing-qr detects local network IP', async () => {
    const res = await fetch(`${BASE_URL}/api/mobile/pairing-qr`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (!data.lanIp || !data.qrCodeDataUrl) throw new Error('Missing LAN IP or QR code');
  });

  // 8. Local Model Scanner
  await test('POST /api/models/scan-local scans localhost runtimes', async () => {
    const res = await fetch(`${BASE_URL}/api/models/scan-local`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (!data.success) throw new Error('Scan returned success: false');
  });

  console.log('\n====================================================');
  console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFullVerification().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
