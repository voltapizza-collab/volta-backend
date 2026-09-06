import express from 'express';
import posUiRoutes from './posUi.js';
import { authenticateDevice, enrollDevice, loginStore, requireStoreSession, logoutStore, safeDevice } from '../services/posIdentity.js';

export default function posIdentityRoutes(prisma) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/devices/enroll', async (req, res) => res.status(201).json({ device: await enrollDevice(prisma, req) }));
  router.use(async (req, _res, next) => { req.posDevice = await authenticateDevice(prisma, req); next(); });
  router.get('/device', (req, res) => res.json({ device: safeDevice(req.posDevice), serverTime: new Date().toISOString() }));
  router.post('/session', async (req, res) => res.json(await loginStore(prisma, req.posDevice.id, req.body)));
  // A device can always close its own store session even if the PIN/session expired.
  router.delete('/session', async (req, res) => { await logoutStore(prisma, req.posDevice.id); res.json({ ok: true }); });
  router.use(async (req, _res, next) => {
    req.posSession = await requireStoreSession(prisma, req.posDevice.id, req.get('authorization'));
    next();
  });
  router.get('/bootstrap', (req, res) => {
    const { store, expiresAt } = req.posSession;
    res.json({ device: safeDevice(req.posDevice), expiresAt,
      store: { id: store.id, name: store.storeName, slug: store.slug, active: store.active, acceptingOrders: store.acceptingOrders },
      partner: { id: store.partnerId, name: store.partner.name, slug: store.partner.slug, currency: store.partner.currency },
    });
  });
  router.use('/ui', posUiRoutes(prisma));
  router.get('/orders', async (req, res) => {
    if (Object.keys(req.query).some(key => !['after'].includes(key))) return res.status(400).json({ error: 'unsupported_query' });
    const after = Number(req.query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) return res.status(400).json({ error: 'invalid_cursor' });
    const { storeId, partnerId } = req.posSession;
    const items = await prisma.sale.findMany({ where: { storeId, partnerId, status: 'PAID', processed: false,
      id: { gt: after } }, orderBy: { id: 'asc' }, take: 101,
      select: { id: true, code: true, date: true, total: true, currency: true, products: true, delivery: true } });
    const more = items.length > 100;
    res.json({ items: items.slice(0, 100), nextCursor: more ? items[99].id : null });
  });
  router.use((error, _req, res, _next) => {
    if (!error.status) console.error('[pos-identity]', error.code || error.name);
    res.status(error.status || 500).json({ error: error.status ? error.code : 'pos_service_error' });
  });
  return router;
}
