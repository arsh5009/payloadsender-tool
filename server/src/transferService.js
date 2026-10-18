import { sendTcp } from './senders/tcpSender.js';
import { sendUdp } from './senders/udpSender.js';
import { describeAssurance } from './senders/common.js';
import { validateSize } from './validation.js';

/** Picks the sender for the transport, enforces size limits and returns a plain-language summary. */
export async function runTransfer({ file, target, signal, onEvent, config }) {
  validateSize(file.size, target.transport, config);
  const common = { filePath: file.path, size: file.size, host: target.host, port: target.port, signal, onEvent };
  const result = target.transport === 'TCP' ? await sendTcp(common) : await sendUdp(common);
  return { bytesSent: result.bytesSent, assurance: result.assurance, summary: describeAssurance(result.assurance) };
}
