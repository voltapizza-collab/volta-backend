import express from 'express';
import myordersRoutes from './myorders.js';
import storesRoutes from './stores.js';
import reservationsRoutes from './reservations.js';
import presenceRoutes from './presence.js';
import storeIngredientsRoutes from './storeIngredients.js';

// Called only after the device signature AND store session have been verified.
// Existing business handlers are reachable only through this explicit allowlist.
export function posUiScope(prisma) {
  return async (req, res, next) => {
    const { storeId, partnerId } = req.posSession;
    const path = req.path;
    const method = req.method;
    const deny = () => res.status(403).json({ error: 'pos_scope_denied' });
    const query = { ...req.query };
    if ((query.storeId !== undefined && String(query.storeId) !== String(storeId)) ||
        (query.partnerId !== undefined && String(query.partnerId) !== String(partnerId))) return deny();
    let allowed = false;
    const storeInfo = /^\/api\/stores\/(\d+)$/.exec(path);
    if (storeInfo && method === 'GET') { if (Number(storeInfo[1]) !== storeId) return deny(); allowed = true; }
    if (method === 'GET' && /^\/api\/myorders\/(pending|summary)$/.test(path)) {
      if (Object.keys(query).some(k => !['storeId','partnerId','_ts','period'].includes(k))) return deny();
      query.storeId = String(storeId); query.partnerId = String(partnerId); allowed = true;
    }
    const store = /^\/(?:api\/)?stores\/(\d+)\/(active|operations-pause|ingredients(?:\/\d+)?)$/.exec(path);
    if (store) {
      if (Number(store[1]) !== storeId) return deny();
      allowed = (['active', 'operations-pause'].includes(store[2]) && method === 'PATCH') ||
        (store[2] === 'ingredients' && method === 'GET') ||
        (/^ingredients\/\d+$/.test(store[2]) && method === 'PATCH');
    }
    const presence = /^\/api\/presence\/stores\/(\d+)\/status$/.exec(path);
    if (presence && method === 'GET') {
      if (Number(presence[1]) !== storeId) return deny();
      query.partnerId = String(partnerId); allowed = true;
    }
    const today = /^\/api\/reservations\/today\/(\d+)$/.exec(path);
    if (today && method === 'GET') { if (Number(today[1]) !== storeId) return deny(); allowed = true; }
    const order = /^\/api\/myorders\/(\d+)\/(ready|messages|messages\/read)$/.exec(path);
    if (order && ((order[2] === 'ready' && method === 'PATCH') ||
        (order[2] === 'messages' && ['GET','POST'].includes(method)) ||
        (order[2] === 'messages/read' && method === 'PATCH'))) {
      if (!await prisma.sale.findFirst({ where: { id: Number(order[1]), storeId, partnerId }, select: { id: true } })) return deny();
      allowed = true;
    }
    const reservation = /^\/api\/reservations\/(\d+)\/complete$/.exec(path);
    if (reservation && method === 'PATCH') {
      if (!await prisma.reservation.findFirst({ where: { id: Number(reservation[1]), storeId, partnerId }, select: { id: true } })) return deny();
      allowed = true;
    }
    if (!allowed) return deny();
    Object.defineProperty(req, 'query', { value: query, configurable: true });
    next();
  };
}

export default function posUiRoutes(prisma) {
  const router = express.Router();
  router.use(posUiScope(prisma));
  router.get('/api/stores/:id', async (req,res) => {
    const store = await prisma.store.findUnique({ where: { id: req.posSession.storeId }, select: {
      id:true, storeName:true, slug:true, active:true, acceptingOrders:true, operationsPaused:true, city:true, latitude:true, longitude:true,
    } });
    res.json(store);
  });
  router.use('/api/myorders', myordersRoutes(prisma));
  router.use('/api/presence', presenceRoutes());
  router.use('/api/reservations', reservationsRoutes(prisma));
  router.use('/api/stores/:storeId/ingredients', storeIngredientsRoutes);
  router.use('/stores/:storeId/ingredients', storeIngredientsRoutes);
  const stores = storesRoutes(prisma);
  router.use('/api/stores', stores);
  router.use('/stores', stores);
  return router;
}
