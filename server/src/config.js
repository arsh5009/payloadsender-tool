import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const bool = (value, fallback) =>
  value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 5000),
    host: env.HOST || '127.0.0.1',
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/netpayload',
    accessPin: env.ACCESS_PIN || '',
    allowedHosts: String(env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean),
    allowPublicTargets: bool(env.ALLOW_PUBLIC_TARGETS, false),
    allowLoopbackTargets: bool(env.ALLOW_LOOPBACK_TARGETS, false),
    maxTcpBytes: int(env.MAX_TCP_BYTES, 1024 * 1024 * 1024),
    maxUdpBytes: int(env.MAX_UDP_BYTES, 8 * 1024 * 1024),
    uploadDir: env.UPLOAD_DIR || path.join(os.tmpdir(), 'netpayload-uploads'),
    clientDist: env.CLIENT_DIST || path.resolve(here, '../../client/dist'),
  };
}
