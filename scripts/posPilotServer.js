// Local USB pilot: only the new authenticated API, no legacy routes or background workers.
import express from 'express';
import prisma from '../services/prisma.js';
import posIdentityRoutes from '../routes/posIdentity.js';
const app = express();
app.use(express.json({ limit: '16kb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use('/api/pos', posIdentityRoutes(prisma));
const server = app.listen(8091, '127.0.0.1', () => console.log('Volta POS pilot: 127.0.0.1:8091 (USB only)'));
const stop = () => server.close(async () => { await prisma.$disconnect(); process.exit(); });
process.on('SIGTERM', stop); process.on('SIGINT', stop);
