import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { Errors, NetPayloadError, formatBytes } from './errors.js';
import { runTransfer } from './transferService.js';
import { classifyAddress } from './validation.js';

const displayAddress = (t) => (t.host.includes(':') ? `[${t.host}]:${t.port}` : `${t.host}:${t.port}`);

/**
 * Runs one transfer at a time (duplicate sends are rejected), keeps an event log per job so a
 * browser can attach late, and writes a metadata-only history record when a transfer ends.
 */
export class TransferManager {
  constructor({ config, runner = runTransfer, recordHistory = async () => {}, retainMs = 10 * 60 * 1000 }) {
    this.config = config;
    this.runner = runner;
    this.recordHistory = recordHistory;
    this.retainMs = retainMs;
    this.jobs = new Map();
    this.activeId = null;
  }

  isBusy() {
    return this.activeId !== null;
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  /** file: { path, name, size } (temp file, deleted afterwards). target: { host, port, transport }. */
  start({ file, target }) {
    if (this.activeId) throw Errors.busy();
    const job = {
      id: crypto.randomUUID(),
      file,
      target,
      events: [],
      listeners: new Set(),
      status: 'running',
      phase: 'connecting',
      progress: { sent: 0, total: file.size },
      result: null,
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    this.activeId = job.id;
    setImmediate(() => this.#run(job));
    return job;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'running') job.controller.abort();
    return job;
  }

  snapshot(job) {
    return {
      id: job.id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      result: job.result,
      events: job.events,
    };
  }

  /** Replays past events, then streams new ones. Returns an unsubscribe function. */
  subscribe(id, listener) {
    const job = this.jobs.get(id);
    if (!job) return null;
    for (const event of [...job.events]) listener(event);
    if (job.status === 'running') job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  shutdown() {
    for (const job of this.jobs.values()) if (job.status === 'running') job.controller.abort();
  }

  #emit(job, event) {
    const evt = { ...event, ts: Date.now() };
    const last = job.events[job.events.length - 1];
    if (evt.type === 'progress' && last?.type === 'progress') job.events[job.events.length - 1] = evt;
    else job.events.push(evt);
    for (const listener of job.listeners) {
      try {
        listener(evt);
      } catch {
        job.listeners.delete(listener);
      }
    }
  }

  #log(job, level, message) {
    this.#emit(job, { type: 'log', level, message });
  }

  async #run(job) {
    const { file, target } = job;
    const started = Date.now();
    this.#log(job, 'info', `Starting ${target.transport} transfer of “${file.name}” to ${displayAddress(target)}.`);
    if (classifyAddress(target.host) !== 'private') {
      this.#log(job, 'warning', `${target.host} is not a private/local address. NetPayload is intended for devices on your local network.`);
    }
    if (target.transport === 'UDP') this.#log(job, 'warning', 'UDP does not guarantee delivery. Success cannot be confirmed.');

    let outcome;
    let detail;
    let bytesSent = 0;
    let assurance = null;
    try {
      const result = await this.runner({
        file,
        target,
        signal: job.controller.signal,
        config: this.config,
        onEvent: (e) => this.#onSenderEvent(job, e),
      });
      outcome = 'sent';
      bytesSent = result.bytesSent;
      assurance = result.assurance?.kind ?? null;
      detail = result.summary;
      this.#log(job, 'success', `Sent ${formatBytes(bytesSent)} in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
      this.#log(job, 'info', detail);
    } catch (err) {
      const e = err instanceof NetPayloadError ? err : Errors.sendFailed(err?.message || 'unknown error');
      detail = e.message;
      outcome = e.code === 'CANCELLED' ? 'cancelled' : e.code === 'TIMEOUT' ? 'timedOut' : 'failed';
      this.#log(job, outcome === 'cancelled' ? 'warning' : 'error', detail);
    }

    job.status = 'finished';
    job.result = { outcome, detail, bytesSent, assurance };
    this.activeId = null; // free the slot before announcing, so a new transfer can start right away
    this.#emit(job, { type: 'done', ...job.result });
    job.listeners.clear();

    await fs.unlink(file.path).catch(() => {});
    try {
      await this.recordHistory({
        host: target.host,
        port: target.port,
        transport: target.transport,
        filename: file.name,
        byteCount: file.size,
        outcome,
        detail,
      });
    } catch {
      /* history is best-effort; sending must never depend on the database */
    }
    setTimeout(() => this.jobs.delete(job.id), this.retainMs).unref();
  }

  #onSenderEvent(job, event) {
    if (event.type === 'phase') {
      job.phase = event.phase;
      this.#emit(job, { type: 'phase', phase: event.phase });
      if (event.phase === 'connected') this.#log(job, 'info', 'Connected.');
    } else if (event.type === 'progress') {
      job.progress = { sent: event.sent, total: event.total };
      this.#emit(job, { type: 'progress', sent: event.sent, total: event.total });
    }
  }
}
