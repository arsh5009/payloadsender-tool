import { Errors, NetPayloadError } from '../errors.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Maps a socket/file error to a friendly NetPayloadError. */
export function mapSocketError(err, { aborted = false, stalled = false, stage = 'connecting to the device', udp = false } = {}) {
  if (aborted) return Errors.cancelled();
  if (err instanceof NetPayloadError) return err;
  if (stalled) return Errors.timeout('sending data (the device stopped accepting it)');
  switch (err?.code) {
    case 'ECONNREFUSED':
      return udp
        ? Errors.connectionFailed('the device reported that nothing is listening on that UDP port.')
        : Errors.connectionRefused();
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
    case 'ENETDOWN':
      return Errors.hostUnreachable();
    case 'ETIMEDOUT':
      return Errors.timeout(stage);
    case 'ECONNRESET':
    case 'EPIPE':
    case 'ECONNABORTED':
    case 'ERR_STREAM_DESTROYED':
    case 'ERR_STREAM_WRITE_AFTER_END':
      return Errors.connectionLost();
    default:
      return Errors.connectionFailed(err?.message || 'unknown error');
  }
}

/** Plain-language description of what the protocol lets us conclude. Never stronger than the evidence. */
export function describeAssurance(a) {
  switch (a.kind) {
    case 'peerClosedCleanly': {
      const reply = a.replyBytes > 0 ? ` It also sent ${a.replyBytes} byte(s) back (not interpreted).` : '';
      return `All bytes were written and the receiver closed the connection cleanly.${reply} This is encouraging but is not an application-level acknowledgement.`;
    }
    case 'peerReset':
      return 'All bytes were written, but the receiver reset the connection afterwards. Some listeners do this after reading the payload; delivery is not confirmed.';
    case 'noSignal':
      return 'All bytes were handed to the network and the stream was closed, but the receiver gave no signal back. Delivery is not confirmed.';
    case 'udpUnconfirmed':
      return 'Datagrams were sent. UDP gives no delivery confirmation, so receipt is unknown.';
    default:
      return 'Sent. Delivery is not confirmed.';
  }
}
