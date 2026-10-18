import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { sendTcp } from '../src/senders/tcpSender.js';
import { sendUdp } from '../src/senders/udpSender.js';

async function tempFile(bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'np-test-'));
  const file = path.join(dir, 'payload.bin');
  await fs.writeFile(file, bytes);
  return file;
}

function tcpReceiver({ read = true, closeAfter = true } = {}) {
  const chunks = [];
  const sockets = [];
  const server = net.createServer({ allowHalfOpen: !closeAfter }, (socket) => {
    sockets.push(socket);
    if (read) {
      socket.on('data', (d) => chunks.push(d));
      socket.on('end', () => closeAfter && socket.end());
    }
    socket.on('error', () => {});
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        received: () => Buffer.concat(chunks),
        close: () => { sockets.forEach((s) => s.destroy()); server.close(); },
      })));
}

test('TCP sends the file bytes exactly and reports only what it observed', async () => {
  const payload = crypto.randomBytes(700_000);
  const filePath = await tempFile(payload);
  const rx = await tcpReceiver();
  try {
    const events = [];
    const result = await sendTcp({ filePath, size: payload.length, host: '127.0.0.1', port: rx.port, onEvent: (e) => events.push(e) });
    assert.equal(result.bytesSent, payload.length);
    assert.ok(rx.received().equals(payload), 'received bytes must equal file bytes');
    assert.equal(result.assurance.kind, 'peerClosedCleanly');
    const sent = events.filter((e) => e.type === 'progress').map((e) => e.sent);
    assert.deepEqual(sent, [...sent].sort((a, b) => a - b));
    assert.equal(sent.at(-1), payload.length);
    assert.equal(events[0].phase, 'connecting');
  } finally { rx.close(); }
});

test('TCP: receiver that never replies yields "noSignal", not a delivery claim', async () => {
  const payload = crypto.randomBytes(2048);
  const filePath = await tempFile(payload);
  const rx = await tcpReceiver({ closeAfter: false });
  try {
    const result = await sendTcp({ filePath, size: payload.length, host: '127.0.0.1', port: rx.port, peerCloseGraceMs: 300 });
    assert.equal(result.assurance.kind, 'noSignal');
  } finally { rx.close(); }
});

test('TCP: connection to a closed port is reported clearly', async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const filePath = await tempFile(Buffer.alloc(1024));
  await assert.rejects(
    sendTcp({ filePath, size: 1024, host: '127.0.0.1', port, connectTimeoutMs: 3000 }),
    (e) => ['CONNECTION_REFUSED', 'CONNECTION_FAILED', 'TIMEOUT'].includes(e.code),
  );
});

test('TCP: cancelling aborts a transfer blocked on a receiver that never reads', async () => {
  const filePath = await tempFile(Buffer.alloc(64 * 1024 * 1024));
  const rx = await tcpReceiver({ read: false });
  try {
    const controller = new AbortController();
    const promise = sendTcp({ filePath, size: 64 * 1024 * 1024, host: '127.0.0.1', port: rx.port, signal: controller.signal });
    setTimeout(() => controller.abort(), 400);
    await assert.rejects(promise, (e) => e.code === 'CANCELLED');
  } finally { rx.close(); }
});

test('TCP: a receiver that stops reading triggers the stall timeout', async () => {
  const filePath = await tempFile(Buffer.alloc(64 * 1024 * 1024));
  const rx = await tcpReceiver({ read: false });
  try {
    await assert.rejects(
      sendTcp({ filePath, size: 64 * 1024 * 1024, host: '127.0.0.1', port: rx.port, stallTimeoutMs: 800 }),
      (e) => e.code === 'TIMEOUT',
    );
  } finally { rx.close(); }
});

test('TCP: file that changes size is detected', async () => {
  const filePath = await tempFile(Buffer.alloc(1000));
  const rx = await tcpReceiver();
  try {
    await assert.rejects(
      sendTcp({ filePath, size: 2000, host: '127.0.0.1', port: rx.port }),
      (e) => e.code === 'FILE_CHANGED',
    );
  } finally { rx.close(); }
});

test('UDP sends small datagrams and never claims confirmation', async () => {
  const payload = crypto.randomBytes(20_000);
  const filePath = await tempFile(payload);
  const server = dgram.createSocket('udp4');
  const sizes = [];
  server.on('message', (msg) => sizes.push(msg.length));
  await new Promise((r) => server.bind(0, '127.0.0.1', r));
  try {
    const result = await sendUdp({ filePath, size: payload.length, host: '127.0.0.1', port: server.address().port });
    assert.equal(result.bytesSent, payload.length);
    assert.equal(result.assurance.kind, 'udpUnconfirmed');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(sizes.length > 0);
    assert.ok(sizes.every((n) => n <= 1400));
    assert.equal(sizes.reduce((a, b) => a + b, 0), payload.length); // loopback is normally lossless
  } finally { server.close(); }
});
