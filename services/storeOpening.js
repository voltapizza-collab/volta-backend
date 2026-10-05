import { buildOrderAvailability } from './orderAvailability.js';
import { loadStoreMenuProducts } from './storeMenuProducts.js';
import { isStripeCheckoutConfigured } from './stripe.js';

export function hasStoreCoordinates(store) {
  return [store?.latitude, store?.longitude].every(v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) &&
    Math.abs(Number(store.latitude)) <= 90 && Math.abs(Number(store.longitude)) <= 180;
}

const parse = value => {
  try { return typeof value === 'string' ? parse(JSON.parse(value)) : value || {}; } catch { return {}; }
};

// Only checks methods supported by the order checkout, not POS/SMS billing.
export function hasOrderPayment(store, cardConfigured = isStripeCheckoutConfigured()) {
  const policy = parse(store.partner?.paymentPolicySettings);
  const raw = parse(policy.cashStoreIds);
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  return cardConfigured || (Boolean(policy.cash) && (!ids.length || ids.includes(store.id)));
}

export function openingBlockers(store, products, now = new Date(), cardConfigured) {
  const blockers = [];
  if (!store.active) blockers.push('store_disabled');
  if (!store.partner?.active) blockers.push('partner_disabled');
  if (!hasStoreCoordinates(store)) blockers.push('coordinates');
  if (store.pickupEnabled === false && store.deliveryEnabled === false) blockers.push('delivery_method');
  if (!store.hours?.some(row => Number.isInteger(row.dayOfWeek) && row.dayOfWeek >= 0 && row.dayOfWeek <= 6 &&
      Number.isInteger(row.openTime) && row.openTime >= 0 && row.openTime < 1440 &&
      Number.isInteger(row.closeTime) && row.closeTime >= 0 && row.closeTime <= 1440)) blockers.push('hours');
  const sellable = products.some(p => p.stocks?.[0]?.active === true &&
    (!p.launchAt || new Date(p.launchAt) <= now) && (!p.availableUntil || new Date(p.availableUntil) > now) &&
    p.selectSize?.some(size => Number.isFinite(Number(p.priceBySize?.[size])) && Number(p.priceBySize?.[size]) > 0) &&
    p.ingredients.every(row => row.ingredient?.status === 'ACTIVE' && row.ingredient.storeStocks?.[0]?.active === true));
  if (!sellable) blockers.push('menu');
  if (!hasOrderPayment(store, cardConfigured)) blockers.push('payment');
  return blockers;
}

export async function readStoreOpening(db, storeId) {
  const store = await db.store.findUnique({ where: { id: storeId }, include: { hours: true,
    partner: { select: { active: true, paymentPolicySettings: true } } } });
  if (!store) return null;
  const products = await loadStoreMenuProducts(db, store.partnerId, store.id);
  const blockers = openingBlockers(store, products);
  const availability = buildOrderAvailability(store);
  return { id: store.id, active: store.active, acceptingOrders: store.acceptingOrders,
    operationsPaused: store.operationsPaused, canOpen: blockers.length === 0, blockers,
    status: availability.status, serviceOpen: availability.serviceOpen,
    scheduledOrdersAvailable: availability.days.some(day => day.slots.length > 0) };
}
