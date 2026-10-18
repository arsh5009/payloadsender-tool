import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { Errors } from './errors.js';
import { errorHandler, requireDb } from './middleware.js';
import { createPinGuard, guardRequests } from './security.js';
import { profilesRouter } from './routes/profiles.js';
import { historyRouter } from './routes/history.js';
import { transfersRouter } from './routes/transfers.js';

export function createApp({ config, manager }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      // Defaults would add "upgrade-insecure-requests", which breaks plain-http LAN use.
      contentSecurityPolicy: {
        directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null },
      },
      hsts: false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  api.use(guardRequests({ allowedHosts: config.allowedHosts }));
  const dbUp = () => mongoose.connection.readyState === 1;
  api.get('/health', (_req, res) => res.json({ ok: true, db: dbUp() }));
  api.get('/config', (_req, res) =>
    res.json({
      pinRequired: Boolean(config.accessPin),
      maxTcpBytes: config.maxTcpBytes,
      maxUdpBytes: config.maxUdpBytes,
      allowPublicTargets: config.allowPublicTargets,
      db: dbUp(),
    }),
  );
  api.use(createPinGuard(config.accessPin));
  api.use('/profiles', requireDb, profilesRouter());
  api.use('/history', requireDb, historyRouter());
  api.use('/transfers', transfersRouter({ manager, config }));
  api.use((_req, _res, next) => next(Errors.notFound()));
  app.use('/api', api);

  // Serve the built React app when present (production: one origin, one port).
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist));
    app.get('*', (_req, res) => res.sendFile(indexHtml));
  }

  app.use(errorHandler);
  return app;
}
