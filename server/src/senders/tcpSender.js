import net from 'node:net';
import fs from 'node:fs/promises';
import { Errors } from '../errors.js';
import { mapSocketError } from './common.js';

function connect(socket, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Errors.timeout('connecting to the device'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      reject(new Error('The connection was closed before it was established.'));
    });
    socket.connect({ host, port });
  });
}

function writeChunk(socket, buffer, stallMs, onStall) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onStall();
      socket.destroy();
    }, stallMs);
    socket.write(buffer, (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    });
  });
}

/** After our FIN, observe how the receiver reacts. None of these outcomes is an application-level ACK. */
function finish(socket, graceMs) {
  return new Promise((resolve) => {
    let received = 0;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => done({ kind: 'noSignal' }), graceMs);
    socket.on('data', (d) => {
      received += d.length;
    });
    socket.once('end', () => done({ kind: 'peerClosedCleanly', replyBytes: received }));
    socket.once('error', () => done({ kind: 'peerReset' }));
    socket.once('close', () => done({ kind: 'noSignal' }));
    socket.end(); // FIN: tells the receiver the payload is complete
  });
}

/**
 * Streams a file over TCP, exactly as stored, in chunks (never fully loaded into memory).
 * `preamble` is an optional Buffer for receivers that need a header; default is raw bytes only.
 */
export async function sendTcp({
  filePath,
  size,
  host,
  port,
  signal,
  onEvent = () => {},
  chunkSize = 128 * 1024,
  connectTimeoutMs = 10_000,
  stallTimeoutMs = 15_000,
  peerCloseGraceMs = 3_000,
  preamble = null,
}) {
  if (signal?.aborted) throw Errors.cancelled();
  const state = { stalled: false, stage: 'connecting to the device' };
  const socket = new net.Socket();
  socket.on('error', () => {}); // errors surface through the awaited promises; avoid unhandled 'error'
  const onAbort = () => socket.destroy();
  signal?.addEventListener('abort', onAbort, { once: true });

  let handle;
  try {
    try {
      handle = await fs.open(filePath, 'r');
    } catch {
      throw Errors.fileAccess();
    }

    onEvent({ type: 'phase', phase: 'connecting' });
    await connect(socket, host, port, connectTimeoutMs);
    onEvent({ type: 'phase', phase: 'connected' });

    state.stage = 'sending data';
    const onStall = () => {
      state.stalled = true;
    };
    if (preamble) await writeChunk(socket, preamble, stallTimeoutMs, onStall);

    const buffer = Buffer.allocUnsafe(chunkSize);
    let sent = 0;
    onEvent({ type: 'phase', phase: 'sending' });
    onEvent({ type: 'progress', sent: 0, total: size });
    for (;;) {
      if (signal?.aborted) throw Errors.cancelled();
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, null);
      if (bytesRead === 0) break;
      await writeChunk(socket, buffer.subarray(0, bytesRead), stallTimeoutMs, onStall);
      sent += bytesRead;
      onEvent({ type: 'progress', sent, total: size });
    }
    if (sent !== size) throw Errors.fileChanged();

    onEvent({ type: 'phase', phase: 'finishing' });
    const assurance = await finish(socket, peerCloseGraceMs);
    if (signal?.aborted) throw Errors.cancelled();
    return { bytesSent: sent, assurance };
  } catch (err) {
    throw mapSocketError(err, { aborted: signal?.aborted, stalled: state.stalled, stage: state.stage });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    socket.destroy();
    await handle?.close().catch(() => {});
  }
}
