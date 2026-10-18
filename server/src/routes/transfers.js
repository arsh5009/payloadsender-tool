import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Errors, NetPayloadError } from '../errors.js';
import { assertTargetAllowed, parsePort, parseTransport, validateHost, validateSize } from '../validation.js';

/** Display-only file name: no path parts or control characters. */
function cleanName(raw, fallback) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[\\/]/)
    .pop()
    .trim()
    .slice(0, 255);
  return name || fallback || 'payload';
}

export function transfersRouter({ manager, config }) {
  const router = Router();
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
    }),
    limits: { fileSize: Math.max(config.maxTcpBytes, config.maxUdpBytes), files: 1, fields: 10 },
  });

  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

  const rejectIfBusy = (_req, _res, next) => (manager.isBusy() ? next(Errors.busy()) : next());

  const receiveFile = (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new NetPayloadError('FILE_TOO_LARGE', 'The file is larger than the server allows.', 413));
      }
      return next(new NetPayloadError('UPLOAD_FAILED', `Upload failed: ${err.message}`, 400));
    });

  router.post('/', limiter, rejectIfBusy, receiveFile, async (req, res, next) => {
    const uploaded = req.file;
    try {
      if (!uploaded) throw Errors.noFile();
      const host = validateHost(req.body?.host);
      const port = parsePort(req.body?.port);
      const transport = parseTransport(req.body?.transport);
      assertTargetAllowed(host, config);
      validateSize(uploaded.size, transport, config);

      const job = manager.start({
        file: { path: uploaded.path, name: cleanName(req.body?.filename, cleanName(uploaded.originalname)), size: uploaded.size },
        target: { host, port, transport },
      });
      res.status(202).json({ id: job.id });
    } catch (err) {
      if (uploaded) fs.unlink(uploaded.path, () => {});
      next(err);
    }
  });

  // Snapshot (handy for polling and tests)
  router.get('/:id', (req, res, next) => {
    const job = manager.get(req.params.id);
    if (!job) return next(Errors.notFound());
    res.json(manager.snapshot(job));
  });

  // Live progress via Server-Sent Events; late subscribers get a full replay.
  router.get('/:id/events', (req, res, next) => {
    const job = manager.get(req.params.id);
    if (!job) return next(Errors.notFound());
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    let unsubscribe = () => {};
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    const send = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'done') {
        cleanup();
        res.end();
      }
    };
    unsubscribe = manager.subscribe(job.id, send) ?? (() => {});
    req.on('close', cleanup);
  });

  router.delete('/:id', (req, res, next) => {
    const job = manager.cancel(req.params.id);
    if (!job) return next(Errors.notFound());
    res.status(job.status === 'running' ? 202 : 200).json({ ok: true, status: job.status });
  });

  return router;
}
