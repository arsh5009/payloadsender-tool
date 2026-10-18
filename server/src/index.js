import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { TransferManager } from './transferManager.js';
import { addRecord } from './models/TransferRecord.js';

const config = loadConfig();

// Never block startup on MongoDB: sending works without it; profiles/history need it.
mongoose.set('bufferCommands', false);
mongoose
  .connect(config.mongoUri, { serverSelectionTimeoutMS: 4000 })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.warn(`MongoDB not connected (${err.message}). Profiles and history are disabled; sending still works.`));

const manager = new TransferManager({
  config,
  recordHistory: async (record) => {
    if (mongoose.connection.readyState === 1) await addRecord(record);
  },
});

// Remove stale uploads left behind by a crash.
async function cleanUploads() {
  await fs.mkdir(config.uploadDir, { recursive: true });
  for (const name of await fs.readdir(config.uploadDir)) {
    const file = path.join(config.uploadDir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 60 * 60 * 1000) await fs.unlink(file).catch(() => {});
  }
}
await cleanUploads().catch(() => {});

const app = createApp({ config, manager });
const server = app.listen(config.port, config.host, () => {
  console.log(`NetPayload server listening on http://${config.host}:${config.port}`);
  if (config.host !== '127.0.0.1' && !config.accessPin) {
    console.warn('WARNING: the server is reachable from your network and ACCESS_PIN is not set.');
  }
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the other NetPayload server (Ctrl+C in its terminal), or set a different PORT in server/.env and restart.`);
  } else {
    console.error('NetPayload server failed to start:', err);
  }
  process.exit(1);
});

function shutdown() {
  manager.shutdown();
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
