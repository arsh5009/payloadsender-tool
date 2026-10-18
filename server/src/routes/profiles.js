import { Router } from 'express';
import mongoose from 'mongoose';
import { Profile } from '../models/Profile.js';
import { Errors } from '../errors.js';
import { validateHost, parsePort, parseTransport } from '../validation.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseBody(body) {
  const host = validateHost(body?.host);
  const port = parsePort(body?.port);
  const transport = parseTransport(body?.transport);
  const name = String(body?.name ?? '').trim().slice(0, 60) || host;
  return { name, host, port, transport };
}

const toDto = (d) => ({ id: String(d._id), name: d.name, host: d.host, port: d.port, transport: d.transport });

export function profilesRouter() {
  const router = Router();

  router.get('/', wrap(async (_req, res) => {
    res.json((await Profile.find().sort({ createdAt: 1 })).map(toDto));
  }));

  router.post('/', wrap(async (req, res) => {
    res.status(201).json(toDto(await Profile.create(parseBody(req.body))));
  }));

  router.put('/:id', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw Errors.notFound();
    const doc = await Profile.findByIdAndUpdate(req.params.id, parseBody(req.body), { new: true, runValidators: true });
    if (!doc) throw Errors.notFound();
    res.json(toDto(doc));
  }));

  router.delete('/:id', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw Errors.notFound();
    await Profile.findByIdAndDelete(req.params.id);
    res.status(204).end();
  }));

  return router;
}
