// Mirrors the server rules for instant feedback. The server always re-validates.

export function isValidIPv4(text) {
  const parts = String(text).split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^[0-9]{1,3}$/.test(p) && !(p.length > 1 && p.startsWith('0')) && Number(p) <= 255);
}

export function isValidIPv6(text) {
  const addr = String(text).split('%')[0];
  if (!addr.includes(':') || !/^[0-9a-fA-F:.]+$/.test(addr)) return false;
  try {
    new URL(`http://[${addr}]/`);
    return true;
  } catch {
    return false;
  }
}

/** Returns an error message, or '' when valid. Empty input returns '' (no nagging while typing). */
export function hostError(raw) {
  const host = String(raw ?? '').trim();
  if (!host) return '';
  if (isValidIPv4(host)) {
    return host === '0.0.0.0' || host === '255.255.255.255' ? `${host} is not a usable device address.` : '';
  }
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return isValidIPv6(stripped) ? '' : `“${host}” is not a valid IPv4 or IPv6 address.`;
}

export function portError(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return /^[0-9]{1,5}$/.test(text) && Number(text) >= 1 && Number(text) <= 65535
    ? ''
    : `“${text}” is not a valid port. Use a number from 1 to 65535.`;
}

export const normalizeHost = (raw) => {
  const host = String(raw ?? '').trim();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
};

export function isPrivateAddress(host) {
  const h = normalizeHost(host).toLowerCase();
  if (isValidIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd');
}

export function fileProblem(file, transport, config) {
  if (!file) return '';
  if (file.size === 0) return 'The selected file is empty (0 bytes), so there is nothing to send.';
  const limit = transport === 'TCP' ? config?.maxTcpBytes : config?.maxUdpBytes;
  if (limit && file.size > limit) {
    return `This file is larger than the ${transport} limit of ${(limit / 1048576).toFixed(0)} MB.`;
  }
  return '';
}
