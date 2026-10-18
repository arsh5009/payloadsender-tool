import crypto from 'node:crypto';
import net from 'node:net';
import { Errors } from './errors.js';

function hostnameOf(hostHeader) {
  if (hostHeader.startsWith('[')) return hostHeader.slice(1, hostHeader.indexOf(']'));
  return hostHeader.split(':')[0];
}

/**
 * Blocks browser-based attacks against a local service:
 *  - CSRF: a web page on another site cannot make your browser POST to this server (Origin must match Host).
 *  - DNS rebinding: the Host header must be localhost, an IP address, or listed in ALLOWED_HOSTS.
 * Requests without an Origin header (curl, same-origin GET) are allowed; browsers always send Origin on POST.
 */
export function guardRequests({ allowedHosts = [] } = {}) {
  const extra = new Set(allowedHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean));
  return (req, _res, next) => {
    const hostHeader = String(req.headers.host || '').toLowerCase();
    const hostname = hostnameOf(hostHeader);
    const hostOk = hostname === 'localhost' || net.isIP(hostname) !== 0 || extra.has(hostname);
    if (!hostOk) {
      return next(Errors.forbidden('Unrecognised Host header. If you use a hostname, add it to ALLOWED_HOSTS on the server.'));
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        /* "null" or malformed origin */
      }
      if (originHost !== hostHeader) return next(Errors.forbidden('Cross-origin requests are not allowed.'));
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return next(Errors.forbidden('Cross-site requests are not allowed.'));
    }
    return next();
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Optional shared PIN with lock-out after repeated wrong guesses (per client IP). */
export function createPinGuard(pin, { maxFailures = 10, windowMs = 5 * 60_000, now = Date.now } = {}) {
  const failures = new Map(); // ip -> { count, first }
  return (req, _res, next) => {
    if (!pin) return next();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const record = failures.get(key);
    if (record && now() - record.first > windowMs) failures.delete(key);
    const current = failures.get(key);
    if (current && current.count >= maxFailures) return next(Errors.tooManyAttempts());

    const supplied = req.headers['x-access-pin'] ?? req.query?.pin ?? '';
    if (safeEqual(supplied, pin)) {
      failures.delete(key);
      return next();
    }
    if (supplied !== '') {
      failures.set(key, current ? { ...current, count: current.count + 1 } : { count: 1, first: now() });
    }
    return next(Errors.unauthorized());
  };
}
