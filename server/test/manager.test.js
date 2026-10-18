import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TransferManager } from '../src/transferManager.js';
import { Errors } from '../src/errors.js';

async function tempFile(size = 10) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'np-mgr-'));
  const p = path.join(dir, 'f.bin');
  await fs.writeFile(p, Buffer.alloc(size));
  return { path: p, name: 'f.bin', size };
}
const target = { host: '192.168.1.5', port: 9020, transport: 'TCP' };
const waitDone = (mgr, id) => new Promise((resolve) => { mgr.subscribe(id, (e) => e.type === 'done' && resolve(e)); });

test('successful transfer: events, history record, temp file cleanup', async () => {
  const history = [];
  const mgr = new TransferManager({
    config: {},
    recordHistory: async (r) => history.push(r),
    runner: async ({ onEvent }) => {
      onEvent({ type: 'phase', phase: 'connected' });
      onEvent({ type: 'progress', sent: 10, total: 10 });
      return { bytesSent: 10, assurance: { kind: 'noSignal' }, summary: 'summary text' };
    },
  });
  const file = await tempFile();
  const job = mgr.start({ file, target });
  const done = await waitDone(mgr, job.id);
  assert.equal(done.outcome, 'sent');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(history.length, 1);
  assert.equal(history[0].filename, 'f.bin');
  assert.ok(!JSON.stringify(history[0]).toLowerCase().includes('payload'));
  await assert.rejects(fs.access(file.path), 'temp file should be deleted');
  assert.equal(mgr.isBusy(), false);
});

test('duplicate sends are rejected while one is running', async () => {
  let release;
  const mgr = new TransferManager({
    config: {},
    runner: () => new Promise((resolve) => { release = () => resolve({ bytesSent: 1, assurance: { kind: 'noSignal' }, summary: '' }); }),
  });
  const first = mgr.start({ file: await tempFile(), target });
  assert.throws(() => mgr.start({ file: { path: 'x', name: 'x', size: 1 }, target }), (e) => e.code === 'BUSY' && e.status === 409);
  await new Promise((r) => setTimeout(r, 20));
  release();
  await waitDone(mgr, first.id);
  assert.equal(mgr.isBusy(), false);
});

test('cancel and error outcomes are classified', async () => {
  const mgr = new TransferManager({
    config: {},
    runner: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Errors.cancelled()))),
  });
  const job = mgr.start({ file: await tempFile(), target });
  setTimeout(() => mgr.cancel(job.id), 20);
  assert.equal((await waitDone(mgr, job.id)).outcome, 'cancelled');

  const failing = new TransferManager({ config: {}, runner: async () => { throw Errors.timeout('connecting'); } });
  const j2 = failing.start({ file: await tempFile(), target });
  assert.equal((await waitDone(failing, j2.id)).outcome, 'timedOut');

  const crashing = new TransferManager({ config: {}, runner: async () => { throw new Error('boom'); } });
  const j3 = crashing.start({ file: await tempFile(), target });
  const done = await waitDone(crashing, j3.id);
  assert.equal(done.outcome, 'failed');
  assert.match(done.detail, /boom/);
});

test('a late subscriber gets the full replay and history failures never break sending', async () => {
  const mgr = new TransferManager({
    config: {},
    recordHistory: async () => { throw new Error('db down'); },
    runner: async ({ onEvent }) => { onEvent({ type: 'progress', sent: 5, total: 10 }); return { bytesSent: 10, assurance: { kind: 'noSignal' }, summary: 's' }; },
  });
  const job = mgr.start({ file: await tempFile(), target });
  await waitDone(mgr, job.id);
  const replay = [];
  mgr.subscribe(job.id, (e) => replay.push(e.type));
  assert.ok(replay.includes('log'));
  assert.equal(replay.at(-1), 'done');
  assert.equal(mgr.snapshot(job).status, 'finished');
});
