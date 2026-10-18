import net from 'node:net';
import { Errors } from './errors.js';

export function isValidIPv4(text) {
  const parts = String(text).split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^[0-9]{1,3}$/.test(p) && !(p.length > 1 && p.startsWith('0')) && Number(p) <= 255);
}

export function validateHost(raw) {
  const host = String(raw ?? '').trim();
  if (!host) throw Errors.invalidHost('Enter the device’s IP address.');
  if (isValidIPv4(host)) {
    if (host === '0.0.0.0' || host === '255.255.255.255') {
      throw Errors.invalidHost(`${host} is not a usable device address.`);
    }
    return host;
  }
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (stripped.includes(':') && net.isIPv6(stripped)) return stripped;
  throw Errors.invalidHost(`“${host}” is not a valid IPv4 or IPv6 address.`);
}

export function parsePort(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw Errors.invalidPort('Enter a port number (1–65535).');
  if (!/^[0-9]{1,5}$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw Errors.invalidPort(`“${text}” is not a valid port. Use a number from 1 to 65535.`);
  }
  return Number(text);
}

export function parseTransport(raw) {
  const t = String(raw ?? '').toUpperCase();
  if (t !== 'TCP' && t !== 'UDP') throw Errors.invalidTransport();
  return t;
}

/** Returns 'private' | 'loopback' | 'link-local' | 'public'. */
export function classifyAddress(host) {
  const h = String(host).toLowerCase();
  if (isValidIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 127) return 'loopback';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
    if (a === 169 && b === 254) return 'link-local';
    return 'public';
  }
  if (h === '::1') return 'loopback';
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyAddress(mapped[1]);
  if (/^fe[89ab][0-9a-f]?:/.test(h) || h.startsWith('fe80')) return 'private';   // IPv6 link-local (per-interface)
  if (h.startsWith('fc') || h.startsWith('fd')) return 'private';                // IPv6 unique local
  return 'public';
}

/**
 * Server-side guard: this API opens sockets on behalf of the browser, so by default it only
 * talks to private LAN addresses. (169.254.x.x is blocked because cloud metadata services live there.)
 */
export function assertTargetAllowed(host, { allowPublicTargets = false, allowLoopbackTargets = false } = {}) {
  const kind = classifyAddress(host);
  if (kind === 'private') return;
  if (kind === 'loopback' && (allowLoopbackTargets || allowPublicTargets)) return;
  if (allowPublicTargets) return;
  throw Errors.targetNotAllowed(
    `${host} is not a private local-network address. NetPayload only sends to devices on your local network ` +
      `(set ALLOW_PUBLIC_TARGETS=true on the server to change this).`,
  );
}

export function validateSize(size, transport, limits) {
  if (!(size > 0)) throw Errors.fileEmpty();
  const limit = transport === 'TCP' ? limits.maxTcpBytes : limits.maxUdpBytes;
  if (size > limit) throw Errors.fileTooLarge(size, limit, transport);
}
