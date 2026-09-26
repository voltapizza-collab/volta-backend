import fs from 'node:fs';
import assert from 'node:assert/strict';
import express from 'express';
import v8 from 'node:v8';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';
import { captureTables, tableDigests } from './lib/ingredientTaxonomyRehearsal.js';

// No source fallback, payment provider, or outbound notifications in this rehearsal.
process.env.DATABASE_URL = validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
process.env.TELNYX_API_KEY = '';
process.env.STRIPE_SECRET_KEY = '';
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, ...args) => {
  assert.equal(new URL(url).hostname, '127.0.0.1', 'External network forbidden');
  return originalFetch(url, ...args);
};
const { default: axios } = await import('axios');
axios.interceptors.request.use(() => { throw new Error('External requests forbidden in taxonomy audit'); });
const { default: prisma } = await import('../services/prisma.js');
const { default: inventory } = await import('../routes/storeIngredients.js');
const { default: menuRoutes } = await import('../routes/menuDisponible.js');
const { default: storeRoutes } = await import('../routes/stores.js');
const { default: usesRoutes } = await import('../routes/ingredientCategoryUses.js');
const { default: extrasRoutes } = await import('../routes/ingredientExtras.js');
const { posUiScope } = await import('../routes/posUi.js');
const app = express();
app.use(express.json());
app.use('/pos/:auditStoreId', (req, res, next) => {
  req.posSession = { storeId: Number(req.params.auditStoreId), partnerId: 1 }; next();
}, posUiScope(prisma));
app.use('/pos/:auditStoreId/stores/:storeId/ingredients', inventory);
app.use('/inventory/:storeId/ingredients', inventory);
app.use('/menu', menuRoutes(prisma));
app.use('/stores', storeRoutes(prisma));
app.use('/uses', usesRoutes(prisma));
app.use('/extras', extrasRoutes(prisma));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const checks = [];
const findings = [];
const request = async (path, method = 'GET', body, expectedStatus = 200) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(data).slice(0, 160)}`);
  if (path.startsWith('/stores/') && path.endsWith('/menu')) assert.equal(response.headers.get('cache-control'), 'no-store');
  return data;
};
const ids = rows => rows.map(row => row.pizzaId).sort((a, b) => a - b);
let before;
try {
  before = await captureTables(prisma);
  fs.writeFileSync(new URL('../.cache/taxonomy-audit-before.bin', import.meta.url), v8.serialize({
    StoreIngredientStock: before.StoreIngredientStock,
    Partner: before.Partner.map(row => ({ id: row.id, trackingNotificationSettings: row.trackingNotificationSettings })),
  }));
  // Suppress real recipients on this isolated copy; restore exact bytes in finally.
  await prisma.$executeRawUnsafe('UPDATE Partner SET trackingNotificationSettings = NULL');
  for (const store of before.Store) {
    const partner = before.Partner.find(row => row.id === store.partnerId);
    const publicPath = store.active && store.latitude != null && store.longitude != null && partner
      ? `/stores/${encodeURIComponent(partner.slug)}/${encodeURIComponent(store.slug)}/menu` : null;
    const initial = await request(`/inventory/${store.id}/ingredients?scope=menu`);
    const initialMenu = await request(`/menu/${store.id}`);
    const candidates = initial.filter(item => item.exists && item.active && item.affectedProducts > 0);
    for (const ingredient of candidates) {
      const path = `/pos/${store.id}/stores/${store.id}/ingredients/${ingredient.id}`;
      const affected = initialMenu.filter(row => row.ingredients.some(item => item.id === ingredient.id));
      const categoryIds = [...new Set(before.IngredientCategoryUse.filter(row => row.partnerId === store.partnerId && row.ingredientId === ingredient.id).map(row => row.categoryId))];
      const usesBefore = new Map();
      const extraCategoryIds = [...new Set(before.IngredientExtra.filter(row=>row.partnerId===store.partnerId&&row.ingredientId===ingredient.id&&row.status==='ACTIVE').map(row=>row.categoryId))];
      const extrasBefore = new Map();
      for(const categoryId of extraCategoryIds) extrasBefore.set(categoryId,await request(`/extras?storeId=${store.id}&categoryId=${categoryId}`));
      for (const categoryId of categoryIds) usesBefore.set(categoryId, await request(`/uses?storeId=${store.id}&categoryId=${categoryId}`));
      let publicBefore;
      if (publicPath && affected.length) publicBefore = await request(publicPath);
      const off = await request(path, 'PATCH', { active: false, source: 'pos' });
      assert.equal(off.active, false);
      assert.equal(off.notification?.reason, 'tracking_disabled');
      const offAgain = await request(path, 'PATCH', { active: false, source: 'pos' });
      assert.equal(offAgain.notification, null, 'Repeated OFF must not notify twice');
      const offInventory = await request(`/inventory/${store.id}/ingredients?scope=menu`);
      const changed = offInventory.find(row => row.id === ingredient.id);
      assert.equal(changed.active, false);
      assert.equal(changed.taxonomy.categoryKey, ingredient.taxonomy.categoryKey);
      assert.equal(changed.affectedProducts, ingredient.affectedProducts);
      const offMenu = await request(`/menu/${store.id}`);
      assert.deepEqual(ids(offMenu), ids(initialMenu.filter(row => !affected.some(item => item.pizzaId === row.pizzaId))), 'Only dependent dishes must disappear');
      for(const categoryId of extraCategoryIds) assert.ok(!(await request(`/extras?storeId=${store.id}&categoryId=${categoryId}`)).some(row=>row.ingredientId===ingredient.id),'Disabled ingredient remained purchasable as extra');
      for (const categoryId of categoryIds) {
        const offUses = await request(`/uses?storeId=${store.id}&categoryId=${categoryId}`);
        assert.ok(!offUses.some(row => row.id === ingredient.id), 'Disabled ingredient remains selectable');
        assert.deepEqual(offUses, usesBefore.get(categoryId).filter(row => row.id !== ingredient.id), 'Other extras changed');
      }
      if (publicBefore) {
        const immediately = await request(publicPath);
        const retainedIds = affected.filter(row => immediately.menu.some(item => item.pizzaId === row.pizzaId)).map(row => row.pizzaId);
        if (retainedIds.length) findings.push({ code: 'PUBLIC_MENU_CACHE_RETAINS_DISABLED', storeId: store.id, ingredientId: ingredient.id, retainedPizzaIds: retainedIds, configuredTtlMs: Number(process.env.PUBLIC_MENU_CACHE_MS || 30000) });
        assert.deepEqual(retainedIds, [], 'Public menu retained a disabled dish');
      }
      const afterOff = await captureTables(prisma);
      assert.deepEqual(afterOff.StoreIngredientStock.filter(row => row.storeId !== store.id || row.ingredientId !== ingredient.id), before.StoreIngredientStock.filter(row => row.storeId !== store.id || row.ingredientId !== ingredient.id), 'Another stock row changed');
      await request(path, 'PATCH', { active: true, source: 'pos' });
      if (publicBefore) assert.deepEqual(ids((await request(publicPath)).menu), ids(publicBefore.menu), 'Public menu did not recover immediately');
      assert.deepEqual(await request(`/menu/${store.id}`), initialMenu, 'Reactivation did not restore dishes, recipes and prices');
      for (const categoryId of categoryIds) assert.deepEqual(await request(`/uses?storeId=${store.id}&categoryId=${categoryId}`), usesBefore.get(categoryId));
      for(const categoryId of extraCategoryIds) assert.deepEqual(await request(`/extras?storeId=${store.id}&categoryId=${categoryId}`),extrasBefore.get(categoryId));
      // Restore updatedAt too, so subsequent candidates compare against the same snapshot.
      const original = before.StoreIngredientStock.find(row => row.storeId === store.id && row.ingredientId === ingredient.id);
      await prisma.$executeRawUnsafe('UPDATE StoreIngredientStock SET active = ?, stock = ?, updatedAt = ? WHERE storeId = ? AND ingredientId = ?', original.active, original.stock, original.updatedAt, original.storeId, original.ingredientId);
      checks.push({ storeId: store.id, ingredientId: ingredient.id, family: ingredient.taxonomy.categoryKey, affectedDishes: affected.length, extrasCategories: categoryIds.length, purchasableExtraCategories:extraCategoryIds.length, disableReactivate: true, publicMenuChecked: Boolean(publicBefore), unrelatedStockUnchanged: true });
    }
    if (candidates.length) {
      const foreign = before.Store.find(row => row.id !== store.id);
      await request(`/pos/${store.id}/stores/${foreign.id}/ingredients/${candidates[0].id}`, 'PATCH', { active: false, source: 'pos' }, 403);
    }
  }
  assert.ok(checks.length > 0, 'No state transitions exercised');
} finally {
  if (before) {
    for (const row of before.StoreIngredientStock) await prisma.$executeRawUnsafe('UPDATE StoreIngredientStock SET active = ?, stock = ?, updatedAt = ? WHERE storeId = ? AND ingredientId = ?', row.active, row.stock, row.updatedAt, row.storeId, row.ingredientId);
    for (const row of before.Partner) await prisma.$executeRawUnsafe('UPDATE Partner SET trackingNotificationSettings = ? WHERE id = ?', row.trackingNotificationSettings == null || typeof row.trackingNotificationSettings === 'string' ? row.trackingNotificationSettings : JSON.stringify(row.trackingNotificationSettings), row.id);
    const after = await captureTables(prisma);
    const restored = tableDigests(after);
    assert.deepEqual(restored, tableDigests(before), 'Audit did not restore all original tables');
    const report = { verifiedAt: new Date().toISOString(), database: 'isolated_loopback_copy', tablesRestored: Object.keys(before).length, exercisedIngredients: checks.length, familiesExercised: [...new Set(checks.map(row => row.family))], checks, findings, tableDigests: restored };
    fs.writeFileSync(new URL('../docs/ingredient-taxonomy-v2-flow-repair-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ exercisedIngredients: checks.length, tablesRestored: Object.keys(before).length, findings }));
  }
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}
