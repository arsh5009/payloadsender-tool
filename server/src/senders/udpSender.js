import dgram from 'node:dgram';
import net from 'node:net';
import fs from 'node:fs/promises';
import { Errors } from '../errors.js';
import { mapSocketError, sleep } from './common.js';

/** Sends a file as UDP datagrams. UDP gives no delivery, ordering or integrity guarantees. */
export async function sendUdp({
  filePath,
  size,
  host,
  port,
  signal,
  onEvent = () => {},
  datagramSize = 1400, // stays under a typical 1500-byte MTU
  pacingInterval = 32, // pause briefly every N datagrams to avoid flooding the receiver
  pacingDelayMs = 1,
  sendTimeoutMs = 5_000,
}) {
  if (signal?.aborted) throw Errors.cancelled();
  const socket = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
  let socketError = null;
  socket.on('error', (e) => {
    socketError = e; // e.g. ICMP "port unreachable" surfaces here on a connected socket
  });
  const onAbort = () => {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let handle;
  try {
    try {
      handle = await fs.open(filePath, 'r');
    } catch {
      throw Errors.fileAccess();
    }

    onEvent({ type: 'phase', phase: 'connecting' });
    await new Promise((resolve, reject) => {
      const fail = (e) => reject(e);
      socket.once('error', fail);
      socket.connect(port, host, () => {
        socket.removeListener('error', fail);
        resolve();
      });
    });
    onEvent({ type: 'phase', phase: 'connected' });

    const sendOne = (buf, length) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Errors.timeout('sending data')), sendTimeoutMs);
        socket.send(buf, 0, length, (err) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
      });

    const buffer = Buffer.allocUnsafe(datagramSize);
    let sent = 0;
    let count = 0;
    onEvent({ type: 'phase', phase: 'sending' });
    onEvent({ type: 'progress', sent: 0, total: size });
    for (;;) {
      if (signal?.aborted) throw Errors.cancelled();
      if (socketError) throw socketError;
      let filled = 0;
      while (filled < datagramSize) {
        const { bytesRead } = await handle.read(buffer, filled, datagramSize - filled, null);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      if (filled === 0) break;
      await sendOne(buffer, filled);
      sent += filled;
      count += 1;
      if (count % pacingInterval === 0) {
        onEvent({ type: 'progress', sent, total: size });
        await sleep(pacingDelayMs);
      }
      if (filled < datagramSize) break;
    }
    if (socketError) throw socketError;
    if (sent !== size) throw Errors.fileChanged();
    onEvent({ type: 'progress', sent, total: size });
    onEvent({ type: 'phase', phase: 'finishing' });
    return { bytesSent: sent, assurance: { kind: 'udpUnconfirmed' } };
  } catch (err) {
    throw mapSocketError(err, { aborted: signal?.aborted, stage: 'sending data', udp: true });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    await handle?.close().catch(() => {});
  }
}
