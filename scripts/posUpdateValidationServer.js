// Temporary, loopback-only validation service. Expose only through an HTTPS
// tunnel. Production POS/order routes are not mounted or redeployed here.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import prisma from '../services/prisma.js';
import { authenticateDevice } from '../services/posIdentity.js';
import posUpdatesRoutes from '../routes/posUpdates.js';

const catalogueFile = path.resolve(process.argv[2] || 'pos-private/update-catalogue.json');
const eventsFile = path.resolve(process.argv[3] || 'pos-private/update-events.jsonl');
if (!fs.existsSync(catalogueFile)) throw Error('Create an operator-owned update catalogue first');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use('/api/pos/updates', async (req, _res, next) => {
  req.posDevice = await authenticateDevice(prisma, req); next();
}, posUpdatesRoutes(prisma, { catalogueFile, onEvent(event) {
  const row = { at: new Date().toISOString(), ...event };
  fs.appendFileSync(eventsFile, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
} }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.code : 'update_service_error' }));
const server = app.listen(8096, '127.0.0.1', () => console.log('Authenticated POS update validation listening on 127.0.0.1:8096'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await prisma.$disconnect(); process.exit(0); }));
