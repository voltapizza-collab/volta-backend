import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';
import { captureTables, tableDigests } from './lib/ingredientTaxonomyRehearsal.js';
import { validateCheckoutAvailability } from '../services/checkoutAvailability.js';

process.env.DATABASE_URL = validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
process.env.TELNYX_API_KEY = '';
process.env.STRIPE_SECRET_KEY = '';
const { default: prisma } = await import('../services/prisma.js');
const before = await captureTables(prisma);
const barrier = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const options = { isolationLevel: 'ReadCommitted', timeout: 10000 };
const report = { checks: [], database: 'isolated_loopback_copy', paymentsOrMessagesSent: false };
let stock;
try {
  let product, store;
  for (const candidate of before.Store.filter(row => row.active)) {
    product = await prisma.menuPizza.findFirst({ where: { partnerId: candidate.partnerId, status: 'ACTIVE', type: 'SELLABLE', stocks: { some: { storeId: candidate.id, active: true } }, ingredients: { some: {}, every: { ingredient: { status: 'ACTIVE', storeStocks: { some: { storeId: candidate.id, active: true } } } } } }, include: { ingredients: true } });
    if (product) { store = candidate; break; }
  }
  assert.ok(product);
  stock = before.StoreIngredientStock.find(row => row.storeId === store.id && row.ingredientId === product.ingredients[0].ingredientId);
  const lines = [{ cartLineId: 'concurrency', pizzaId: product.id, name: 'Audit', size: product.selectSize[0] }];

  // OFF has written its row but has not committed. Checkout must wait, then
  // observe the committed OFF rather than an earlier repeatable-read snapshot.
  const offWritten = barrier(), commitOff = barrier(), stockReadStarted = barrier();
  const writer = prisma.$transaction(async tx => {
    await tx.storeIngredientStock.update({ where: { storeId_ingredientId: { storeId: stock.storeId, ingredientId: stock.ingredientId } }, data: { active: false } });
    offWritten.resolve(); await commitOff.promise;
  }, options);
  await offWritten.promise;
  const checkout = prisma.$transaction(async tx => {
    const observed = new Proxy(tx, { get(target, key) {
      if (key === '$queryRawUnsafe') return (...args) => {
        if (args[0].includes('FROM StoreIngredientStock')) stockReadStarted.resolve();
        return target.$queryRawUnsafe(...args);
      };
      return target[key];
    } });
    await validateCheckoutAvailability(observed, lines, store.partnerId, store.id);
  }, options).then(() => ({ accepted: true }), error => ({ error }));
  try {
    await stockReadStarted.promise;
    assert.equal(await Promise.race([checkout.then(() => 'completed'), delay(150, 'waiting')]), 'waiting');
  } finally { commitOff.resolve(); }
  await writer;
  const outcome = await checkout;
  assert.equal(outcome.error?.message, 'cart_item_unavailable');
  report.checks.push('disable_first_checkout_waits_then_rejects');
  await prisma.$executeRawUnsafe('UPDATE StoreIngredientStock SET active = 1 WHERE storeId = ? AND ingredientId = ?', stock.storeId, stock.ingredientId);

  // Checkout already validated ACTIVE: OFF must wait until that transaction
  // finishes, establishing a definite ordering rather than accepting stale data.
  const validated = barrier(), commitCheckout = barrier();
  const firstCheckout = prisma.$transaction(async tx => {
    await validateCheckoutAvailability(tx, lines, store.partnerId, store.id);
    validated.resolve(); await commitCheckout.promise;
  }, options);
  await validated.promise;
  const secondWriter = prisma.storeIngredientStock.update({ where: { storeId_ingredientId: { storeId: stock.storeId, ingredientId: stock.ingredientId } }, data: { active: false } }).then(() => 'completed');
  try {
    assert.equal(await Promise.race([secondWriter, delay(150, 'waiting')]), 'waiting');
  } finally { commitCheckout.resolve(); }
  await firstCheckout; await secondWriter;
  report.checks.push('checkout_first_disable_waits_until_commit');
} finally {
  if (stock) await prisma.$executeRawUnsafe('UPDATE StoreIngredientStock SET active = ?, updatedAt = ? WHERE storeId = ? AND ingredientId = ?', stock.active, stock.updatedAt, stock.storeId, stock.ingredientId);
  assert.deepEqual(tableDigests(await captureTables(prisma)), tableDigests(before));
  report.tablesRestored = Object.keys(before).length;
  report.verifiedAt = new Date().toISOString();
  fs.writeFileSync(new URL('../docs/ingredient-taxonomy-v2-concurrency-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  await prisma.$disconnect();
}
