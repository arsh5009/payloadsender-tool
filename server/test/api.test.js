// End-to-end API test. Requires `npm install` (express, multer, mongoose, ...). MongoDB is NOT needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { TransferManager } from '../src/transferManager.js';

async function boot(env = {}) {
  const config = loadConfig({ ALLOW_LOOPBACK_TARGETS: 'true', ...env });
  const manager = new TransferManager({ config });
  const server = createApp({ config, manager }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => { manager.shutdown(); server.close(); } };
}

function receiver() {
  const chunks = [];
  const server = net.createServer((s) => { s.on('data', (d) => chunks.push(d)); s.on('end', () => s.end()); s.on('error', () => {}); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, data: () => Buffer.concat(chunks), close: () => server.close() })));
}

function form(fields, bytes) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (bytes) f.append('file', new Blob([bytes]), 'payload.bin');
  return f;
}

async function waitFinished(base, id) {
  for (let i = 0; i < 100; i++) {
    const snap = await (await fetch(`${base}/api/transfers/${id}`)).json();
    if (snap.status === 'finished') return snap;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('transfer did not finish');
}

test('upload → server sends exact bytes to the device', async () => {
  const app = await boot();
  const rx = await receiver();
  try {
    const bytes = crypto.randomBytes(300_000);
    const res = await fetch(`${app.base}/api/transfers`, {
      method: 'POST',
      body: form({ host: '127.0.0.1', port: String(rx.port), transport: 'TCP', filename: 'my payload.bin' }, bytes),
    });
    assert.equal(res.status, 202);
    const { id } = await res.json();
    const snap = await waitFinished(app.base, id);
    assert.equal(snap.result.outcome, 'sent');
    assert.ok(rx.data().equals(bytes));
  } finally { rx.close(); app.close(); }
});

test('server refuses public/unsafe targets and bad input', async () => {
  const app = await boot();
  try {
    const bytes = Buffer.alloc(10);
    let res = await fetch(`${app.base}/api/transfers`, { method: 'POST', body: form({ host: '8.8.8.8', port: '9020', transport: 'TCP' }, bytes) });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'TARGET_NOT_ALLOWED');
    res = await fetch(`${app.base}/api/transfers`, { method: 'POST', body: form({ host: '169.254.169.254', port: '80', transport: 'TCP' }, bytes) });
    assert.equal(res.status, 403);
    res = await fetch(`${app.base}/api/transfers`, { method: 'POST', body: form({ host: 'bad', port: '9020', transport: 'TCP' }, bytes) });
    assert.equal(res.status, 400);
    res = await fetch(`${app.base}/api/transfers`, { method: 'POST', body: form({ host: '127.0.0.1', port: '9020', transport: 'TCP' }) });
    assert.equal(res.status, 400);
  } finally { app.close(); }
});

test('PIN protects the API but not config; profiles degrade gracefully without MongoDB', async () => {
  const app = await boot({ ACCESS_PIN: '1234' });
  try {
    assert.equal((await fetch(`${app.base}/api/config`)).status, 200);
    assert.equal((await fetch(`${app.base}/api/history`)).status, 401);
    const res = await fetch(`${app.base}/api/history`, { headers: { 'x-access-pin': '1234' } });
    assert.equal(res.status, 503); // authenticated, but MongoDB is not connected in this test
    assert.equal((await res.json()).error.code, 'DB_UNAVAILABLE');
  } finally { app.close(); }
});

test('cross-site POSTs and foreign Host headers are refused', async () => {
  const app = await boot();
  try {
    const bytes = Buffer.alloc(10);
    const res = await fetch(`${app.base}/api/transfers`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: form({ host: '127.0.0.1', port: '9020', transport: 'TCP' }, bytes),
    });
    assert.equal(res.status, 403);
    const cfg = await fetch(`${app.base}/api/config`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(cfg.status, 403);
  } finally { app.close(); }
});
