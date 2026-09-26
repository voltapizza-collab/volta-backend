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
let transactionMutation = null;
const rollbackPrisma = new Proxy(prisma, { get(target, key) {
  if (key === '$transaction') return (callback, options) => target.$transaction(async tx => {
    if(transactionMutation) await transactionMutation(tx);
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
  const {standard, independent}=fixtures;
  const reward=fixtures.cases.find(([kind])=>kind==='reward')[1][1];
  const promo=fixtures.cases.find(([kind])=>kind==='promo')[1][0];
  const cases = [
    ...fixtures.cases.map(([kind,cart])=>['valid_'+kind,cart]),
    ['underpriced',[{...standard,price:0.5,subtotal:0.5}]],
    ['forged_subtotal',[{...standard,subtotal:0.5}]],
    ['unknown_promo',[{...promo,promoId:999999999}]],
    ['promo_composition',[{...promo,promoItems:[{pizzaId:independent.pizzaId,size:'M',quantity:1}]}]],
    ['unknown_reward',[independent,{...reward,incentiveId:999999999}]],
    ['unearned_reward',[reward]],
    ['hidden_incentive',[{...standard,incentiveId:fixtures.incentive.id}]],
    ['negative_quantity',[{...standard,qty:-2}]],
    ['race_price',[standard]],
    ['race_promo',[promo]],
    ['race_reward_threshold',[independent,reward]],
  ];
  for (const active of [true]) {
    await prisma.$executeRawUnsafe('UPDATE StoreIngredientStock SET active = ? WHERE storeId = ? AND ingredientId = ?', active, targetStore.id, targetStock.ingredientId);
    const menu = await (await fetch(`${base}/menu/${targetStore.id}`)).json();
    assert.equal(menu.some(row => row.pizzaId === pizza.pizzaId), active);
    for (const [kind, cart] of cases) {
    for (const paymentMode of ['cash', 'card']) {
    attemptedSale = null;
    transactionMutation = kind==='race_price' ? tx=>tx.menuPizza.update({where:{id:standard.pizzaId},data:{priceBySize:{...pizza.priceBySize,M:standard.price+2}}})
      : kind==='race_promo' ? tx=>tx.promo.update({where:{id:fixtures.promo.id},data:{status:'INACTIVE'}})
      : kind==='race_reward_threshold' ? tx=>tx.incentive.update({where:{id:fixtures.incentive.id},data:{fixedAmount:10000}}) : null;
    const response = await fetch(`${base}/checkout/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      storeId: targetStore.id, partnerId: targetPartner.id, paymentMode, currency: targetPartner.currency,
      delivery: { method: 'PICKUP' }, customer: { id: customer.id }, scheduledFor, cart,
    }) });
    const body = await response.json();
    checks.push({ kind, paymentMode, ingredientActive: active, recipeDishVisible: active, responseStatus: response.status, error: body.error, wouldCreateSale: attemptedSale });
    if (process.argv.includes('--expect-fixed')) {
      if(kind.startsWith('valid_')) { assert.ok(attemptedSale,kind+': '+JSON.stringify(body)); assert.equal(response.status,418); }
      else { assert.equal(attemptedSale,null,kind+' reached sale'); assert.equal(response.status,kind==='negative_quantity'?400:kind==='unearned_reward'?400:409,JSON.stringify(body)); }
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
    findings: checks.filter(row => row.wouldCreateSale && !row.kind.startsWith('valid_')).map(row => row.kind + ':' + row.paymentMode) };
    fs.writeFileSync(new URL(process.argv.includes('--expect-fixed') ? '../docs/checkout-pricing-after.json' : '../docs/checkout-pricing-before.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  await new Promise(resolve => server.close(resolve)); await prisma.$disconnect();
}
