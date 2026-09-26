import fs from 'node:fs';
import { checkoutAuditFixtures } from './lib/checkoutAuditFixtures.js';
import assert from 'node:assert/strict';
import express from 'express';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';
import { captureTables, tableDigests } from './lib/ingredientTaxonomyRehearsal.js';
import { buildOrderAvailability } from '../services/orderAvailability.js';

process.env.DATABASE_URL = validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
process.env.TELNYX_API_KEY = '';
process.env.STRIPE_SECRET_KEY = 'sk_test_audit_not_a_real_key';
const { default: axios } = await import('axios');
axios.interceptors.request.use(() => { throw new Error('External network forbidden in audit'); });
const { default: prisma } = await import('../services/prisma.js');
const { default: checkoutRoutes } = await import('../routes/checkout.js');
const { default: menuRoutes } = await import('../routes/menuDisponible.js');
const { default: storesRoutes } = await import('../routes/stores.js');
let attemptedSale = null;
const rollbackPrisma = new Proxy(prisma, { get(target, key) {
  if (key === '$transaction') return (callback, options) => target.$transaction(async tx => {
    const result = await callback(tx);
    attemptedSale = { status: result.status, productIds: result.products.map(row => row.pizzaId), total: Number(result.total) };
    throw Object.assign(new Error('AUDIT_ROLLBACK_AFTER_SALE'), { status: 418 });
  }, options);
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
} });
const app = express(); app.use(express.json());
app.use('/stores', storesRoutes(prisma)); app.use('/menu', menuRoutes(prisma)); app.use('/checkout', checkoutRoutes(rollbackPrisma));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const before = await captureTables(prisma);
const checks = [];
const jsonField = value => value == null || typeof value === 'string' ? value : JSON.stringify(value);
const cleanup=[];
let targetStore, targetPartner, targetStock;
try {
  let pizza, originalMenu;
  for (const store of before.Store.filter(row => row.active && row.pickupEnabled)) {
    const menu = await (await fetch(`${base}/menu/${store.id}`)).json();
    const candidate = menu.find(row => row.ingredients.length && row.selectSize.length);
    if (candidate) { targetStore = store; pizza = candidate; originalMenu = menu; break; }
  }
  assert.ok(pizza, 'No available dish for checkout audit');
  targetPartner = before.Partner.find(row => row.id === targetStore.partnerId);
  targetStock = before.StoreIngredientStock.find(row => row.storeId === targetStore.id && row.ingredientId === pizza.ingredients[0].id);
  await prisma.$executeRawUnsafe('UPDATE Partner SET paymentPolicySettings = ?, minimumPaymentAmount = 0 WHERE id = ?', JSON.stringify({ cash: true }), targetPartner.id);
  await prisma.$executeRawUnsafe('UPDATE Store SET acceptingOrders = 1 WHERE id = ?', targetStore.id);
  const liveStore = await prisma.store.findUnique({ where: { id: targetStore.id }, include: { hours: true } });
  const availability = buildOrderAvailability(liveStore);
  const scheduledFor = availability.requiresSchedule ? availability.days.flatMap(day => day.slots)[0]?.scheduledFor : undefined;
  assert.ok(!availability.requiresSchedule || scheduledFor);
  const customer = before.Customer.find(row => row.partnerId === targetPartner.id);
  assert.ok(customer);
  const publicMenu = await (await fetch(base+'/stores/'+targetPartner.slug+'/'+targetStore.slug+'/menu')).json();
  const fixtures=await checkoutAuditFixtures(prisma,targetPartner,targetStore,publicMenu,cleanup);
  pizza=fixtures.pizza;
  targetStock=before.StoreIngredientStock.find(row=>row.storeId===targetStore.id&&row.ingredientId===fixtures.ingredientId);
  assert.ok(targetStock);
  const cases=fixtures.cases;
  for (const active of [true, false]) {
    await prisma.$executeRawUnsafe('UPDATE StoreIngredientStock SET active = ? WHERE storeId = ? AND ingredientId = ?', active, targetStore.id, targetStock.ingredientId);
    const menu = await (await fetch(`${base}/menu/${targetStore.id}`)).json();
    assert.equal(menu.some(row => row.pizzaId === pizza.pizzaId), active);
    for (const [kind, cart] of cases) {
    for (const paymentMode of ['cash', 'card']) {
    attemptedSale = null;
    const response = await fetch(`${base}/checkout/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      storeId: targetStore.id, partnerId: targetPartner.id, paymentMode, currency: targetPartner.currency,
      delivery: { method: 'PICKUP' }, customer: { id: customer.id }, scheduledFor, cart,
    }) });
    const body = await response.json();
    const shouldAccept=active || kind==='custom_independent';
    checks.push({ kind, paymentMode, shouldAccept, ingredientActive: active, recipeDishVisible: active, responseStatus: response.status, error: body.error, wouldCreateSale: attemptedSale });
    if (shouldAccept) assert.ok(attemptedSale, `Control checkout did not reach sale: ${body.error}`);
    else {
      assert.equal(response.status, 409, JSON.stringify(body));
      assert.equal(body.error, 'cart_item_unavailable');
      assert.equal(attemptedSale, null);
    }
    }
    }
  }
} finally {
  for(const undo of cleanup.reverse()) await undo();
  if (targetStock) await prisma.$executeRawUnsafe('UPDATE StoreIngredientStock SET active = ?, updatedAt = ? WHERE storeId = ? AND ingredientId = ?', targetStock.active, targetStock.updatedAt, targetStock.storeId, targetStock.ingredientId);
  if (targetPartner) await prisma.$executeRawUnsafe('UPDATE Partner SET paymentPolicySettings = ?, minimumPaymentAmount = ? WHERE id = ?', jsonField(targetPartner.paymentPolicySettings), targetPartner.minimumPaymentAmount, targetPartner.id);
  if (targetStore) await prisma.$executeRawUnsafe('UPDATE Store SET acceptingOrders = ? WHERE id = ?', targetStore.acceptingOrders, targetStore.id);
  const after = await captureTables(prisma);
  assert.deepEqual(tableDigests(after), tableDigests(before), 'Checkout audit changed original data');
  const report = { verifiedAt: new Date().toISOString(), database: 'isolated_loopback_copy', tablesRestored: Object.keys(before).length,
    saleTransactionsRolledBack: true, paymentsOrMessagesSent: false, checks,
    findings: checks.some(row => !row.shouldAccept && row.wouldCreateSale) ? ['CHECKOUT_ACCEPTS_DISH_WITH_DISABLED_INGREDIENT'] : [] };
    fs.writeFileSync(new URL('../docs/ingredient-taxonomy-v2-checkout-repair-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  await new Promise(resolve => server.close(resolve)); await prisma.$disconnect();
}
