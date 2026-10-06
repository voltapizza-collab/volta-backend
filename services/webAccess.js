import { readWebSession } from './webSessions.js';
import { posUiScope } from '../routes/posUi.js';
import { verifyPublicAction } from './publicCapabilities.js';

const denied = () => Object.assign(new Error('business_scope_denied'), { status: 403 });
const id = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const canonical = req => decodeURIComponent(req.path).replace(/^\/api(?=\/)/, '').replace(/\/$/, '') || '/';

// Public routes have their own business validation / signed webhook / capability token.
// Everything else requires a server session, including aliases and newly added routes.
export function isPublicWebRoute(method, path) {
  const read = ['GET', 'HEAD'].includes(method);
  if (read && /^\/(?:health|backoffice(?:\/[^/]+)?|Backoffice(?:\/[^/]+)?)$/.test(path)) return true;
  if (read && path === '/') return true;
  if (method === 'POST' && /^\/partners\/(?:backoffice-login|backoffice-demo-session|pos-login|backoffice-password\/(?:request|reset))$/.test(path)) return true;
  if (read && /^\/partners\/(?!by-id$|global$)[^/]+$/.test(path)) return true;
  if (method === 'POST' && /^\/partners\/[^/]+\/delivery\/resolve$/.test(path)) return true;
  if (read && /^\/stores\/(?:nearest|reservations-enabled)$/.test(path)) return true;
  // Exclude private route names regardless of how their id is written. Business
  // handlers also accept Number('1e1') / Number('0xA'); digits-only exclusions leak.
  if (read && /^\/stores\/[^/]+\/[^/]+(?:\/menu)?$/.test(path) &&
      !/^\/stores\/[^/]+\/(?:report|pos-credentials|ingredients|active|operations-pause|order-reception)(?:\/|$)/i.test(path)) return true;
  if (read && /^\/(?:menuDisponible\/\d+|ingredient-extras|ingredient-category-uses|incentives\/active\/one)$/.test(path)) return true;
  if (read && /^\/coupons\/(?:resolve-link\/[^/]+|games|gallery|gallery-pools|gallery-context)$/.test(path)) return true;
  if (method === 'POST' && /^\/coupons\/(?:validate|direct-claim)$/.test(path)) return true;
  if ((read && /^\/games\/[^/]+\/[^/]+\/status$/.test(path)) ||
      (method === 'POST' && /^\/games\/[^/]+\/[^/]+\/(?:play|claim)$/.test(path))) return true;
  if ((read && /^\/checkout\/availability\/\d+$/.test(path)) ||
      (method === 'POST' && /^\/checkout\/(?:session|session\/confirm|stripe\/webhook)$/.test(path))) return true;
  if (method === 'POST' && /^\/(?:sms-credits\/stripe\/webhook|webhooks\/telnyx|presence\/heartbeat|scheduled-orders\/confirm|onboarding\/requests)$/.test(path)) return true;
  if ((read || method === 'POST') && /^\/onboarding\/form\/[^/]+(?:\/sign-contract)?$/.test(path)) return true;
  if (method === 'POST' && /^\/onboarding\/form\/[^/]+\/draft$/.test(path)) return true;
  if (method === 'POST' && /^\/onboarding\/form\/[^/]+\/closure\/(?:consent|checkout|refresh|cancel)$/.test(path)) return true;
  if (method === 'POST' && path === '/onboarding/stripe/webhook') return true;
  if ((read || method === 'POST') && /^\/product-reviews\/[^/]+$/.test(path)) return true;
  if ((read && /^\/sales\/seguimiento\/[^/]+$/.test(path)) || (method === 'POST' && /^\/sales\/seguimiento\/[^/]+\/messages$/.test(path))) return true;
  if ((read && path === '/reservations/availability') || (method === 'POST' && path === '/reservations')) return true;
  if (read && path === '/customers/restriction') return true;
  if (read && path === '/myorders/queue-size') return true;
  if ((read && path === '/myorders/boosts/quote') || (method === 'POST' && path === '/myorders/boosts/activate')) return true;
  return false;
}

export async function assertOwned(db, session, model, value) {
  const resourceId = id(value);
  if (!resourceId) throw denied();
  const row = await db[model].findUnique({ where: { id: resourceId } });
  if (!row) throw denied();
  let partnerId = row.partnerId;
  if (model === 'storeHours') partnerId = (await db.store.findUnique({ where: { id: row.storeId } }))?.partnerId;
  if (Number(partnerId) !== session.partnerId) throw denied();
  if (session.role === 'pos' && ((model === 'store' ? row.id : row.storeId) !== session.storeId)) throw denied();
  return row;
}

// Also called AFTER multipart parsing: a file upload must not bypass body ownership checks.
export async function assertWebInput(req, db) {
  const session = req.webSession;
  if (!session || session.role === 'global_admin') return;
  const walk = async (value, depth = 0) => {
    if (depth > 12) throw denied();
    if (!value || typeof value !== 'object') return;
    for (const [key, raw] of Object.entries(value)) {
      if (key === 'partnerId' && id(raw) !== session.partnerId) throw denied();
      if (key === 'storeId' && raw !== null && raw !== '') await assertOwned(db, session, 'store', raw);
      if (key === 'storeIds') {
        let values = raw;
        if (typeof raw === 'string') { try { values = JSON.parse(raw); } catch { throw denied(); } }
        if (!Array.isArray(values)) throw denied();
        for (const item of values) await assertOwned(db, session, 'store', item);
      }
      if (key === 'payload' && typeof raw === 'string') {
        try { await walk(JSON.parse(raw), depth + 1); } catch { throw denied(); }
      }
      const refs = { customerId: 'customer', pizzaId: 'menuPizza', rewardPizzaId: 'menuPizza', saleId: 'sale', couponId: 'coupon' };
      if (refs[key] && raw !== null && raw !== '') await assertOwned(db, session, refs[key], raw);
      await walk(raw, depth + 1);
    }
  };
  await walk(req.query);
  await walk(req.body);
}

export function multipartWebScope(db) {
  return async (req, res, next) => {
    try { await assertWebInput(req, db); next(); }
    catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'authorization_unavailable' }); }
  };
}

export async function authorizeBackoffice(db, req, path) {
  const s = req.webSession;
  await assertWebInput(req, db);
  if (req.method === 'POST' && path === '/partners/backoffice-password/change') return;
  const read = ['GET', 'HEAD'].includes(req.method);
  let match;
  if ((match = /^\/partners\/by-id\/(\d+)(?:\/(?:policy|policies|price-adjustments|storefront-buttons|tracking-notifications|branding|logo)(?:\/[^/]+)?)?$/.exec(path)) ||
      (match = /^\/(?:billing|sms-credits|backoffice-notifications)\/(\d+)(?:\/(?:summary|checkout-session|invoices\/send|cashouts\/instant))?$/.exec(path)) ||
      (match = /^\/partners\/(\d+)\/categories(?:\/order|\/\d+)?$/.exec(path))) {
    if (id(match[1]) !== s.partnerId) throw denied();
    return;
  }
  if ((match = /^\/stores\/(\d+)(?:\/(?:active|operations-pause|order-reception|report|pos-credentials(?:\/regenerate)?|ingredients(?:\/\d+(?:\/details)?)?))?$/.exec(path)) ||
      (match = /^\/stock\/(\d+)(?:\/\d+(?:\/active)?)?$/.exec(path)) ||
      (match = /^\/reservations\/(?:store|today)\/(\d+)$/.exec(path)) ||
      (match = /^\/presence\/stores\/(\d+)\/status$/.exec(path))) {
    await assertOwned(db, s, 'store', match[1]); return;
  }
  if ((match = /^\/store-hours\/(\d+)$/.exec(path))) {
    await assertOwned(db, s, read ? 'store' : 'storeHours', match[1]); return;
  }
  const resources = [
    [/^\/customers\/(\d+)(?:\/restrict)?$/, 'customer'],
    [/^\/pizzas\/(\d+)(?:\/links)?$/, 'menuPizza'],
    [/^\/promos\/(\d+)$/, 'promo'], [/^\/direct-discounts\/(\d+)$/, 'directDiscount'],
    [/^\/incentives\/(\d+)(?:\/activate)?$/, 'incentive'],
    [/^\/myorders\/(\d+)\/(?:ready|messages(?:\/read)?)$/, 'sale'],
    [/^\/reservations\/(\d+)\/(?:complete|cancel|canceled|confirmed)$/, 'reservation'],
    [/^\/coupons\/channel-shift-qr\/(\d+)(?:\/(?:stop|reactivate))?$/, 'coupon'],
  ];
  for (const [pattern, model] of resources) if ((match = pattern.exec(path))) { await assertOwned(db, s, model, match[1]); return; }
  // Lists always receive the authenticated partner, never an optional all-business filter.
  const lists = /^\/(?:stores|customers(?:\/(?:admin|search|segment-stats|resegment))?|pizzas(?:\/overview)?|promos|direct-discounts|incentives|ingredient-extras(?:\/all|\/\d+)?|ingredient-category-uses(?:\/all|\/\d+)?|myorders\/(?:pending|summary)|coupons\/(?:channel-shift-qr|bulk-generate|push-customer|metrics|redemptions|gallery-pools(?:\/order)?)|communications\/sms\/(?:preview|send)|product-reviews\/analytics\/summary|tracking-alerts)$/;
  if (lists.test(path)) {
    Object.defineProperty(req, 'query', { value: { ...req.query, partnerId: String(s.partnerId) }, configurable: true });
    if (!read && req.body && !req.is('multipart/form-data')) req.body.partnerId = s.partnerId;
    return;
  }
  if (path === '/store-hours' && req.method === 'POST' && req.body?.storeId) return;
  if (read && /^\/(?:categories|sms-credits\/quote|ingredients(?:\/(?:semantic-categories|catalog-pool))?)$/.test(path)) return;
  if (req.method === 'POST' && path === '/ingredients/suggestions') return;
  throw denied();
}

export function webAccess(db) {
  const posScope = posUiScope(db);
  return async (req, res, next) => {
    try {
      const path = canonical(req);
      // The device router independently verifies hardware signatures and its store session.
      if (/^\/pos(?:\/|$)/.test(path)) return next();
      if (req.method === 'GET' && /^\/myorders\/repeat\/(recent|latest)$/.test(path) && req.get('x-volta-receipts')) {
        let tokens;
        try { tokens = JSON.parse(req.get('x-volta-receipts')); } catch { throw denied(); }
        if (!Array.isArray(tokens) || tokens.length > 3) throw denied();
        const ids = tokens.map(token => verifyPublicAction(token, 'repeat')).filter(Boolean);
        if (!ids.length) throw denied();
        req.authorizedRepeatSaleIds = ids;
        res.set('Cache-Control', 'private, no-store');
        return next();
      }
      const cancel = /^\/reservations\/(\d+)\/cancel$/.exec(path);
      if (req.method === 'PATCH' && cancel && req.body?.cancelToken) {
        if (verifyPublicAction(req.body.cancelToken, 'cancel') !== Number(cancel[1])) throw denied();
        return next();
      }
      if (isPublicWebRoute(req.method, path)) return next();
      const session = await readWebSession(db, req.get('authorization'));
      if (!session) return res.status(401).json({ error: 'session_required' });
      req.webSession = session;
      res.set('Cache-Control', 'private, no-store');
      if (session.role === 'global_admin') return next();
      if (session.role === 'pos') {
        await assertWebInput(req, db);
        req.posSession = session;
        return await posScope(req, res, next);
      }
      if (session.role !== 'backoffice') throw denied();
      await authorizeBackoffice(db, req, path);
      next();
    } catch (error) {
      if (!error.status) console.error('[web-access]', error.code || error.name);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'authorization_unavailable' });
    }
  };
}
