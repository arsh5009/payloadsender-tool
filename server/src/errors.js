export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = -1;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

/** User-facing error with a stable code and HTTP status. */
export class NetPayloadError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'NetPayloadError';
    this.code = code;
    this.status = status;
  }
}

export const Errors = {
  invalidHost: (m) => new NetPayloadError('INVALID_HOST', m),
  invalidPort: (m) => new NetPayloadError('INVALID_PORT', m),
  invalidTransport: () => new NetPayloadError('INVALID_TRANSPORT', 'Protocol must be TCP or UDP.'),
  targetNotAllowed: (m) => new NetPayloadError('TARGET_NOT_ALLOWED', m, 403),
  noFile: () => new NetPayloadError('NO_FILE', 'Choose a payload file first.'),
  fileEmpty: () => new NetPayloadError('FILE_EMPTY', 'The selected file is empty (0 bytes), so there is nothing to send.'),
  fileAccess: () => new NetPayloadError('FILE_ACCESS', 'The uploaded file could not be read on the server.', 500),
  fileChanged: () => new NetPayloadError('FILE_CHANGED', 'The file changed while it was being sent. Select it again and retry.'),
  fileTooLarge: (actual, limit, transport) =>
    new NetPayloadError(
      'FILE_TOO_LARGE',
      `This file is ${formatBytes(actual)}, which exceeds the ${formatBytes(limit)} limit for ${transport} transfers.`,
      413,
    ),
  timeout: (stage) => new NetPayloadError('TIMEOUT', `Timed out while ${stage}.`, 504),
  connectionRefused: () =>
    new NetPayloadError('CONNECTION_REFUSED', 'The device refused the connection. Make sure a payload listener is running on that port.', 502),
  hostUnreachable: () =>
    new NetPayloadError('HOST_UNREACHABLE', 'The device could not be reached. Check the IP address and that the NetPayload server is on the same network as the device.', 502),
  connectionLost: () => new NetPayloadError('CONNECTION_LOST', 'The connection was closed by the device while sending.', 502),
  connectionFailed: (r) => new NetPayloadError('CONNECTION_FAILED', `Connection failed: ${r}`, 502),
  sendFailed: (r) => new NetPayloadError('SEND_FAILED', `Sending failed: ${r}`, 500),
  cancelled: () => new NetPayloadError('CANCELLED', 'Transfer cancelled.', 499),
  busy: () => new NetPayloadError('BUSY', 'A transfer is already in progress.', 409),
  notFound: () => new NetPayloadError('NOT_FOUND', 'Not found.', 404),
  dbUnavailable: () =>
    new NetPayloadError('DB_UNAVAILABLE', 'MongoDB is not connected, so profiles and history are unavailable. Sending still works.', 503),
  forbidden: (m) => new NetPayloadError('FORBIDDEN', m, 403),
  tooManyAttempts: () => new NetPayloadError('TOO_MANY_ATTEMPTS', 'Too many incorrect PIN attempts. Try again in a few minutes.', 429),
  unauthorized: () => new NetPayloadError('UNAUTHORIZED', 'A valid access PIN is required.', 401),
};
