import { Router } from 'express';
import { TransferRecord, MAX_HISTORY } from '../models/TransferRecord.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const toDto = (d) => ({
  id: String(d._id),
  time: d.createdAt,
  host: d.host,
  port: d.port,
  transport: d.transport,
  filename: d.filename,
  byteCount: d.byteCount,
  outcome: d.outcome,
  detail: d.detail,
});

export function historyRouter() {
  const router = Router();

  router.get('/', wrap(async (_req, res) => {
    res.json((await TransferRecord.find().sort({ createdAt: -1 }).limit(MAX_HISTORY)).map(toDto));
  }));

  router.delete('/', wrap(async (_req, res) => {
    await TransferRecord.deleteMany({});
    res.status(204).end();
  }));

  return router;
}
