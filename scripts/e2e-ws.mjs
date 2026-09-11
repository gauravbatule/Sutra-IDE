#!/usr/bin/env node
/**
 * SUTRA IDE black-box E2E over the raw WebSocket wire.
 *
 * Outside observer: creates no product files, modifies no product source.
 * Wire protocol (server/wsProtocol.ts): JSON frames {channel,type,payload,timestamp}.
 *   AGENT_STREAM=0x05 (prompt/cancel/steer inbound; chunk/steer_ack/steer_reject outbound)
 *   AGENT_TOOL_CALL=0x06 (result/error)   AGENT_APPROVAL=0x07 (request)
 * Run: node scripts/e2e-ws.mjs   (expects server already listening on :3001)
 */

import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WS_URL = 'ws://localhost:3001/ws';
const BASE = 'http://localhost:3001';
const CH_STREAM = 0x05;
const CH_APPROVAL = 0x07;
const RUN_TIMEOUT_MS = 120000;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- small utils ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/\r/g, '').replace(/\n/g, ' | ').slice(0, 220);

async function getJson(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json();
}
async function postJson(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/* ---------------- socket plumbing ---------------- */
function connect(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const t = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error(`timeout connecting to ${WS_URL}`));
    }, timeoutMs);
    ws.once('open', () => { clearTimeout(t); resolve(ws); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

class Collector {
  constructor(ws) {
    this.ws = ws;
    this.packets = [];
    this.closed = false;
    this.closeCode = null;
    this.error = null;
    ws.on('message', (data) => {
      try { this.packets.push(JSON.parse(data.toString())); } catch { /* malformed frame ignored */ }
    });
    ws.on('close', (code) => { this.closed = true; this.closeCode = code; });
    ws.on('error', (e) => { this.error = e; });
  }
  /** Polls until predicate matches a packet; null on timeout. */
  async waitFor(predicate, timeoutMs, pollMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.packets.find(predicate);
      if (hit) return hit;
      await sleep(pollMs);
    }
    return null;
  }
  /** Accumulated assistant delta text across all chunk packets so far. */
  textSoFar() {
    let t = '';
    for (const p of this.packets) {
      if (p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.delta) t += p.payload.delta;
    }
    return t;
  }
}

function sendPacket(ws, type, payload, channel = CH_STREAM) {
  ws.send(JSON.stringify({ channel, type, payload, timestamp: Date.now() }));
}

function promptPayload(messages, permissionLevel = 'full', chatId = null) {
  return {
    messages,
    permissionLevel,
    priorityIds: [],
    autoCompact: false,
    autoCompactThreshold: 80,
    isGoalMode: false,
    chatId,
    activeTabPath: null,
    activeTabContent: null,
    openTabPaths: [],
    cursorPosition: null,
    selectedText: null,
    selectionRange: null,
    visibleRange: null,
    activeFileDiagnostics: [],
  };
}

/** Resolves when a chunk with done=true arrives (or timeout). */
async function collectRun(col, timeoutMs) {
  const donePkt = await col.waitFor(
    (p) => p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.done === true,
    timeoutMs
  );
  return {
    text: col.textSoFar().trim(),
    sawDone: Boolean(donePkt),
    donePacket: donePkt,
    usage: donePkt?.payload?.usage ?? null,
    timedOut: !donePkt,
  };
}

/* ---------------- harness ---------------- */
const results = [];
function record(name, pass, evidence) {
  results.push({ name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${evidence ? '\n     ' + String(evidence).replace(/\n/g, '\n     ') : ''}\n`);
}
const TRANSIENT = /ECONNRESET|ECONNREFUSED|EPIPE|socket|abnormally|1006|timed?\s?out connecting|fetch failed|PREMATURE_DONE_BEFORE_(CANCEL|STEER)|SOCKET_CLOSED_MID_RUN|SERVER_RESTARTED_MID_RUN|STEER_NO_STREAM_START/i;

/** Unique per-run chat id: isolates the run from the shared 'default' chat's
 *  persisted task_plan.md, whose open items otherwise hijack new prompts into
 *  autonomous plan continuation. */
const freshChatId = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Compact per-packet trace for diagnostics. */
function trace(col, limit = 20) {
  const lines = col.packets.slice(0, limit).map((p) => {
    const body = JSON.stringify(p.payload ?? {}).slice(0, 150);
    return `${p.channel}:${p.type} ${body}`;
  });
  const more = col.packets.length > limit ? `\n     ...(+${col.packets.length - limit} more packets)` : '';
  return `packets=${col.packets.length}\n     ${lines.join('\n     ')}${more}`;
}
/** Throws retryable errors when the transport died mid-run. */
function assertAlive(col, phase) {
  if (col.closed && !col.packets.some((p) => p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.done === true)) {
    throw new Error(`SOCKET_CLOSED_MID_RUN during ${phase} (closeCode=${col.closeCode} err=${esc(col.error)})`);
  }
}

/** Runs a scenario once; retries ONCE only on transport-shaped failures. */
async function scenario(name, fn) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await fn(attempt);
      return;
    } catch (err) {
      const transient = TRANSIENT.test(String(err?.message || err));
      if (attempt === 1 && transient) {
        console.log(`-- ${name}: transient error (${esc(err?.message || err)}), retrying once --`);
        await sleep(3000);
        continue;
      }
      record(name, false, `threw: ${esc(err?.stack || err?.message || err)}`);
      return;
    }
  }
}

/* ================================================================
 * 1. BASIC STREAM
 * ================================================================ */
await scenario('1 BASIC STREAM', async () => {
  const ws = await connect();
  const col = new Collector(ws);
  sendPacket(ws, 'prompt', promptPayload([{ role: 'user', content: 'Reply with exactly: OK' }], 'full', freshChatId()));

  const run = await collectRun(col, RUN_TIMEOUT_MS);
  assertAlive(col, 'basic stream');
  const types = [...new Set(col.packets.map((p) => `${p.channel}:${p.type}`))].join(', ');
  const okText = /OK/.test(run.text);
  const pass = run.sawDone && okText;
  record(
    '1 BASIC STREAM',
    pass,
    `types=[${types}] done=${run.sawDone} usage=${JSON.stringify(run.usage)} socketClosed=${col.closed}\n` +
      `text="${esc(run.text)}"\n` +
      `asserts: textContainsOK=${okText} doneArrived=${run.sawDone}\n` +
      (pass ? '' : trace(col))
  );
  try { ws.close(); } catch {}
});

/* ================================================================
 * 2. CANCEL MID-RUN
 * Note: server/index.ts answers cancel synchronously with ONE final
 * ack chunk {done:true, delta:'*(Generation stopped by user)*'}.
 * So: observe 3s on the live socket post-cancel (stricter than
 * close-first: proves generation truly stopped), then close,
 * reconnect, and health-check the server.
 * ================================================================ */
await scenario('2 CANCEL MID-RUN', async (attempt) => {
  const cancelDelayMs = attempt === 1 ? 1500 : 3000;
  const ws = await connect();
  const col = new Collector(ws);
  sendPacket(ws, 'prompt', promptPayload([{ role: 'user', content: 'Write the numbers 1 to 200 each on its own line.' }], 'full', freshChatId()));

  // Let the run clearly start producing content before cancelling.
  await col.waitFor((p) => p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.delta, 30000);
  assertAlive(col, 'await first delta before cancel');
  await sleep(cancelDelayMs);

  if (col.packets.some((p) => p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.done === true)) {
    throw new Error('PREMATURE_DONE_BEFORE_CANCEL');
  }

  sendPacket(ws, 'cancel', {});
  const idxAtCancel = col.packets.length;
  await sleep(3000); // negative window on the OLD (still open) socket

  const post = col.packets.slice(idxAtCancel);
  const ackChunks = [];
  const strayDeltas = [];
  const otherPost = [];
  for (const p of post) {
    if (p.channel === CH_STREAM && p.type === 'chunk') {
      const d = p.payload?.delta || '';
      if (p.payload?.done === true && /stopped by user/i.test(d)) ackChunks.push(p);
      else if (p.payload?.delta) strayDeltas.push(p);
      else otherPost.push(p);
    } else otherPost.push(p);
  }

  try { ws.close(); } catch {}
  await sleep(500);

  // Reconnect + server liveness after the cancelled run.
  const ws2 = await connect();
  const modelsStatus = await fetch(BASE + '/api/models');
  try { ws2.close(); } catch {}

  const pass =
    strayDeltas.length === 0 &&
    modelsStatus.status === 200;
  record(
    '2 CANCEL MID-RUN',
    pass,
    `chunksBeforeCancel=${idxAtCancel} postCancelPackets=${post.length} stopAckChunks=${ackChunks.length} ` +
      `strayDeltaChunks=${strayDeltas.length}\n` +
      (ackChunks[0] ? `stopAck="${esc(ackChunks[0].payload.delta)}"\n` : '') +
      (strayDeltas.length ? `STRAY="${esc(strayDeltas.map((p) => p.payload.delta).join(''))}"\n` : '') +
      `reconnect=ok /api/models=${modelsStatus.status}`
  );
});

/* ================================================================
 * 3. STEER MID-RUN
 * Mechanism discovered in server code: channel 0x05 type 'steer'
 * payload {text}. While a run is active the server queues it and
 * replies steer_ack; it is injected as "[STEERING]: <text>" at the
 * next round boundary (or as a bounded continuation if the run had
 * already entered its final round). Idle runs get steer_reject.
 * ================================================================ */
await scenario('3 STEER MID-RUN', async () => {
  const ws = await connect();
  const col = new Collector(ws);
  sendPacket(ws, 'prompt', promptPayload([{ role: 'user', content: 'Write the numbers 1 to 300 each on its own line.' }], 'full', freshChatId()));

  // Steer as soon as generation is provably underway (first content delta).
  // Patient wait: cold providers can take tens of seconds to first token.
  const first = await col.waitFor((p) => p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.delta, 45000);
  assertAlive(col, 'await first delta before steer');
  if (!first) {
    record(
      '3 STEER MID-RUN',
      false,
      `no content delta streamed within 45s — cannot test mid-run steering\n${trace(col)}`
    );
    try { ws.close(); } catch {}
    return;
  }
  if (col.packets.some((p) => p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.done === true)) {
    throw new Error('PREMATURE_DONE_BEFORE_STEER');
  }
  sendPacket(ws, 'steer', { text: 'Stop listing numbers — skip ahead and just say FINISHED now.' });

  const ack = await col.waitFor((p) => p.type === 'steer_ack' || p.type === 'steer_reject', 10000);
  assertAlive(col, 'await steer response');
  const run = await collectRun(col, RUN_TIMEOUT_MS);
  assertAlive(col, 'collect after steer');
  try { ws.close(); } catch {}

  const gotAck = ack?.type === 'steer_ack';
  const rejected = ack?.type === 'steer_reject';
  const acknowledgedInterruption = /FINISHED/i.test(run.text) ||
    /\b(skip(ped)?|stopp(ed|ing)|interrupt|steer|cut (it )?short)\b/i.test(run.text);
  const pass = gotAck && acknowledgedInterruption;

  record(
    '3 STEER MID-RUN',
    pass,
    `deltasBeforeSteer=${col.packets.filter((p) => p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.delta).length} ` +
      `steerResponse=${ack ? ack.type : 'NONE'}${rejected ? ` reason=${ack.payload?.reason}` : ''} done=${run.sawDone}\n` +
      `finalText="${esc(run.text)}"\n` +
      `asserts: steerAck=${gotAck} acknowledgedInterruption=${acknowledgedInterruption}`
  );
});

/* ================================================================
 * 4. STRICT APPROVAL GATE
 * ================================================================ */
const PROBE = 'e2e-strict-probe.txt';
const WRITE_PROMPT = 'Create a file named e2e-strict-probe.txt in the workspace root. Its entire content must be exactly: hello';

await scenario('4 STRICT APPROVAL GATE', async () => {
  let root = projectRoot;
  try { root = (await getJson('/api/fs/workspace')).path || projectRoot; } catch {}
  const probePath = path.join(root, PROBE);
  fs.rmSync(probePath, { force: true });

  /** Server-side view of gating state (global permission + queued approvals). */
  const swarmStatus = async () => {
    try {
      const s = await getJson('/api/swarm/status');
      return `permissionLevel=${s.permissionLevel} pendingApprovals=${(s.pendingApprovals || []).length}` +
        ((s.pendingApprovals || []).length
          ? ` queued=[${s.pendingApprovals.map((t) => `${t.tool}:${t.id}`).join(', ').slice(0, 120)}]`
          : '');
    } catch (e) { return `status-unavailable:${esc(e.message)}`; }
  };

  /* ---- (a)-(d): first strict run, approve ---- */
  // Pin the GLOBAL gate to strict via the documented endpoint so a concurrent
  // client cannot leave it flipped to full while our run executes.
  await postJson('/api/swarm/permission', { level: 'strict' });
  const wsA = await connect();
  const colA = new Collector(wsA);
  sendPacket(wsA, 'prompt', promptPayload([{ role: 'user', content: WRITE_PROMPT }], 'strict', freshChatId()));

  const reqA = await colA.waitFor(
    (p) => p.channel === CH_APPROVAL && p.type === 'request' && p.payload?.toolCall?.id,
    90000
  );
  assertAlive(colA, 'await approval request A');
  const statusAtTimeoutA = `\n     swarmStatusAfterWait: ${await swarmStatus()}`;
  const traceA = reqA ? '' : `\n     traceRunA:\n     ${trace(colA).replace(/\n/g, '\n     ')}`;
  const tcId = reqA?.payload?.toolCall?.id;
  const tcSummary = reqA ? `${reqA.payload.toolCall.tool}:${esc(JSON.stringify(reqA.payload.toolCall.params))}` : 'NONE';

  // (b) negative window: nothing may be written while unapproved —
  // checked on the FILESYSTEM regardless of whether a request arrived,
  // so a gate bypass shows up as a hard failure here.
  await sleep(5000);
  const existsWhileUnapproved = fs.existsSync(probePath);
  let ungatedContent = '';
  if (existsWhileUnapproved && !tcId) {
    try { ungatedContent = fs.readFileSync(probePath, 'utf-8').trim().slice(0, 60); } catch {}
  }
  const finishedWhileUnapproved = colA.packets.some(
    (p) => p.channel === CH_STREAM && p.type === 'chunk' && p.payload?.done === true
  );

  // (c) approve via REST (only possible when a queued call exists; also
  // probe endpoint liveness with a bogus id for diagnostics).
  const endpointProbe = await postJson('/api/swarm/approve-tool', { toolCallId: 'e2e-nonexistent-id' });
  const approveRes = tcId ? await postJson('/api/swarm/approve-tool', { toolCallId: tcId }) : null;

  // (d) file appears with content hello
  let appearedAfterApprove = false;
  let contentOk = false;
  {
    const deadline = Date.now() + (approveRes?.body?.success ? 30000 : 5000);
    while (Date.now() < deadline) {
      if (fs.existsSync(probePath)) break;
      await sleep(500);
    }
    appearedAfterApprove = fs.existsSync(probePath);
    if (appearedAfterApprove) contentOk = /hello/i.test(fs.readFileSync(probePath, 'utf-8'));
  }
  // Drain the run to completion.
  await collectRun(colA, 90000).catch(() => {});
  try { wsA.close(); } catch {}

  /* ---- (e): second strict run, NEVER approved ---- */
  fs.rmSync(probePath, { force: true }); // make absence provable
  await postJson('/api/swarm/permission', { level: 'strict' });
  const wsB = await connect();
  const colB = new Collector(wsB);
  sendPacket(wsB, 'prompt', promptPayload([{ role: 'user', content: WRITE_PROMPT }], 'strict', freshChatId()));

  const reqB = await colB.waitFor(
    (p) => p.channel === CH_APPROVAL && p.type === 'request' && p.payload?.toolCall?.id,
    90000
  );
  assertAlive(colB, 'await approval request B');
  const statusAtTimeoutB = `\n     swarmStatusAfterWaitB: ${await swarmStatus()}`;
  const traceB = reqB ? '' : `\n     traceRunB:\n     ${trace(colB).replace(/\n/g, '\n     ')}`;
  await sleep(8000); // unapproved negative window
  const existsUnapprovedSecond = fs.existsSync(probePath);

  // Release the parked run politely so server state resets.
  if (reqB?.payload?.toolCall?.id) {
    await postJson('/api/swarm/reject-tool', { toolCallId: reqB.payload.toolCall.id }).catch(() => {});
    await collectRun(colB, 45000).catch(() => {});
  }
  try { wsB.close(); } catch {}
  await postJson('/api/swarm/permission', { level: 'full' }).catch(() => {});

  fs.rmSync(probePath, { force: true }); // cleanup probe artifact

  const pass =
    Boolean(tcId) &&
    existsWhileUnapproved === false &&
    approveRes?.body?.success === true &&
    appearedAfterApprove &&
    contentOk &&
    Boolean(reqB) &&
    existsUnapprovedSecond === false;

  record(
    '4 STRICT APPROVAL GATE',
    pass,
    `(a) approvalRequest=${tcId ? 'yes id=' + tcId : 'NO'} toolCall=${tcSummary}${statusAtTimeoutA}${traceA}\n` +
      `(b) fileWhileUnapproved=${existsWhileUnapproved}` +
      (ungatedContent ? ` ungatedContent="${esc(ungatedContent)}"` : '') +
      ` runFinishedWhileUnapproved=${finishedWhileUnapproved}\n` +
      `(c) approveHTTP=${approveRes?.status} success=${approveRes?.body?.success} err=${esc(approveRes?.body?.error)} | ` +
      `endpointProbe(bogusId)=${endpointProbe.status}\n` +
      `(d) fileAppeared=${appearedAfterApprove} contentHasHello=${contentOk}\n` +
      `(e) secondApprovalRequest=${reqB ? 'yes id=' + reqB.payload.toolCall.id : 'NO'} fileAfter8sUnapproved=${existsUnapprovedSecond}${statusAtTimeoutB}${traceB}`
  );
});

/* ================================================================
 * 5. PROVIDER RESILIENCE (light, informational — always PASS)
 * ================================================================ */
await scenario('5 PROVIDER RESILIENCE', async () => {
  const data = await getJson('/api/models');
  const models = Array.isArray(data.models) ? data.models : [];
  const providers = {};
  for (const m of models) {
    const prov = m.provider || m.providerId || 'unknown';
    providers[prov] = providers[prov] || { total: 0, available: 0 };
    providers[prov].total += 1;
    if (m.available) providers[prov].available += 1;
  }
  record(
    '5 PROVIDER RESILIENCE',
    true,
    `modelsCount=${models.length} activeModel=${data.activeModel?.name || data.activeModel?.id || '?'}\n` +
      `providers=${JSON.stringify(providers)}\n` +
      `customProviders=${(data.customProviders || []).length}`
  );
});

/* ---------------- summary ---------------- */
console.log('================ E2E SUMMARY ================');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`=============================================`);
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
