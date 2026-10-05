import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import storesRoutes from '../routes/stores.js';
import { openingBlockers, hasOrderPayment } from '../services/storeOpening.js';
import { buildOrderAvailability, validateOrderSchedule } from '../services/orderAvailability.js';
import { isPublicWebRoute, authorizeBackoffice } from '../services/webAccess.js';
import { posUiScope } from '../routes/posUi.js';

const readyStore = () => ({ id: 12, partnerId: 2, active: true, acceptingOrders: false, operationsPaused: true,
  latitude: 40, longitude: -3, pickupEnabled: true, deliveryEnabled: false,
  hours: [{ dayOfWeek: 1, openTime: 840, closeTime: 1380 }],
  partner: { active: true, paymentPolicySettings: { cash: true, cashStoreIds: [12] } } });
const product = () => ({ stocks: [{ active: true }], selectSize: ['M'], priceBySize: { M: 10 }, ingredients: [] });

test('opening identifies every missing requirement and available payment scope', () => {
  assert.deepEqual(openingBlockers(readyStore(), [product()], new Date(), false), []);
  const broken = { ...readyStore(), active: false, partner: { active: false }, latitude: null, hours: [], pickupEnabled: false };
  assert.deepEqual(openingBlockers(broken, [], new Date(), false),
    ['store_disabled', 'partner_disabled', 'coordinates', 'delivery_method', 'hours', 'menu', 'payment']);
  assert.equal(hasOrderPayment({ ...readyStore(), id: 99 }, false), false);
  assert.equal(hasOrderPayment({ ...readyStore(), id: 99 }, true), true);
  for (const change of [{ stocks: [] }, { priceBySize: { M: 0 } }, { launchAt: '2099-01-01' },
    { ingredients: [{ ingredient: { status: 'ACTIVE', storeStocks: [{ active: false }] } }] }]) {
    assert.ok(openingBlockers(readyStore(), [{ ...product(), ...change }], new Date(), false).includes('menu'));
  }
});

test('status distinguishes reception, pause and service hours without disabling scheduled orders', () => {
  const store = { ...readyStore(), acceptingOrders: true };
  const now = new Date('2026-09-07T15:00:00Z');
  assert.equal(buildOrderAvailability(store, now).status, 'paused');
  const slot = buildOrderAvailability(store, now).days[0].slots[0].scheduledFor;
  assert.doesNotThrow(() => validateOrderSchedule(store, slot, now));
  assert.equal(buildOrderAvailability({ ...store, operationsPaused: false }, now).status, 'open');
  assert.equal(buildOrderAvailability({ ...store, operationsPaused: false }, new Date('2026-09-07T08:00:00Z')).status, 'outside_hours');
  const closed = buildOrderAvailability({ ...store, acceptingOrders: false }, now);
  assert.equal(closed.status, 'reception_closed');
  assert.equal(closed.serviceOpen, false);
  assert.ok(closed.days.every(day => !day.slots.length));
  assert.equal(buildOrderAvailability({ ...store, active: false }, now).status, 'store_disabled');
});

test('HTTP opening is explicit, checks requirements and preserves pauses; ordinary edits cannot bypass it', async t => {
  let store = readyStore();
  let products = [{ id: 7, productActive: 1, selectSize: ['M'], priceBySize: { M: 10 }, recipeId: null }];
  const writes = [];
  const db = {
    store: { findUnique: async () => store, update: async ({ data }) => { writes.push(data); store = { ...store, ...data }; return store; } },
    $queryRawUnsafe: async sql => sql.includes('FROM MenuPizza') ? products : [],
    $transaction: async run => run(db),
  };
  const app = express(); app.use(express.json()); app.use(storesRoutes(db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/12`;
  const patch = (suffix, body) => fetch(url + suffix, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let response = await fetch(url + '/order-reception');
  assert.equal((await response.json()).canOpen, true);
  response = await patch('/order-reception', { acceptingOrders: true, operationsPaused: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).operationsPaused, true);
  assert.deepEqual(writes.at(-1), { acceptingOrders: true });
  assert.equal((await patch('', { latitude: 41, longitude: -4 })).status, 200);
  assert.equal(store.acceptingOrders, true); assert.equal(store.operationsPaused, true);
  products = [];
  assert.equal((await patch('/order-reception', { acceptingOrders: false })).status, 200);
  assert.equal((await patch('', { acceptingOrders: true })).status, 409);
  response = await patch('/order-reception', { acceptingOrders: true });
  assert.equal(response.status, 409);
  assert.ok((await response.json()).blockers.includes('menu'));
  assert.equal(store.acceptingOrders, false);
  assert.equal((await patch('/order-reception', { acceptingOrders: 'true' })).status, 400);
  assert.equal((await patch('/active', { active: false })).status, 200);
  assert.equal((await patch('/active', { active: true })).status, 200);
  assert.equal(store.acceptingOrders, false);
  assert.equal(store.operationsPaused, true);
});

test('order-reception routes are private and restricted to owned stores in backoffice and POS', async () => {
  for (const id of ['12', '1e1', '0xA']) assert.equal(isPublicWebRoute('GET', `/stores/${id}/order-reception`), false);
  const db = { store: { findUnique: async ({ where }) => ({ id: where.id, partnerId: where.id === 12 ? 2 : 3 }) } };
  const req = { method: 'PATCH', webSession: { role: 'backoffice', partnerId: 2 }, query: {}, body: { acceptingOrders: true } };
  await authorizeBackoffice(db, req, '/stores/12/order-reception');
  await assert.rejects(authorizeBackoffice(db, req, '/stores/13/order-reception'), /business_scope_denied/);
  for (const method of ['GET', 'PATCH']) for (const id of [12, 13]) {
    let passed = false;
    await posUiScope(db)({ method, path: `/api/stores/${id}/order-reception`, query: {}, posSession: { storeId: 12, partnerId: 2 } },
      { status() { return this; }, json() {} }, () => { passed = true; });
    assert.equal(passed, id === 12);
  }
});
