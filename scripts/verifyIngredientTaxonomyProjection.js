import fs from 'node:fs';
import assert from 'node:assert/strict';
import express from 'express';
import { validateSandboxUrl } from './lib/ingredientTaxonomyPlan.js';
import { captureTables, tableDigests } from './lib/ingredientTaxonomyRehearsal.js';
import { resolveIngredientTaxonomy } from '../services/ingredientTaxonomy.js';

// Only a dedicated loopback copy is accepted, never the source DATABASE_URL.
process.env.DATABASE_URL = validateSandboxUrl(process.env.TAXONOMY_REHEARSAL_DATABASE_URL);
const { default: prisma } = await import('../services/prisma.js');
const { default: ingredients } = await import('../routes/ingredients.js');
const { default: inventory } = await import('../routes/storeIngredients.js');
const { default: categoryUses } = await import('../routes/ingredientCategoryUses.js');
const app = express();
app.use((req, res, next) => req.method === 'GET' ? next() : res.sendStatus(405));
app.use('/ingredients', ingredients);
app.use('/stores/:storeId/ingredients', inventory);
app.use('/ingredient-category-uses', categoryUses(prisma));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const checks = [];
const get = async path => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  assert.equal(response.status, 200, path);
  const rows = await response.json();
  assert.ok(Array.isArray(rows), path);
  checks.push({ path, rows: rows.length });
  return rows;
};
try {
  const before = await captureTables(prisma);
  const rowsById = new Map(before.Ingredient.map(row => [row.id, row]));
  const catalog = await get('/ingredients');
  for (const row of catalog) {
    const original = rowsById.get(row.id);
    assert.equal(row.category, original.category);
    assert.equal(row.canonicalKey, original.canonicalKey);
    assert.equal(row.taxonomy.categoryKey, resolveIngredientTaxonomy(row).categoryKey);
  }
  assert.ok(catalog.length > 0);
  await get('/ingredients/catalog-pool');
  for (const store of before.Store) {
    for (const scope of ['', '?scope=menu']) {
      const items = await get(`/stores/${store.id}/ingredients${scope}`);
      for (const item of items) {
        assert.ok(rowsById.has(item.id));
        assert.equal(item.category, rowsById.get(item.id).category);
        assert.equal(item.taxonomy.categoryKey, resolveIngredientTaxonomy(item).categoryKey);
      }
    }
  }
  const uses = [...new Map(before.IngredientCategoryUse.map(row => [`${row.partnerId}:${row.categoryId}`, row])).values()];
  for (const use of uses) {
    const rows = await get(`/ingredient-category-uses?partnerId=${use.partnerId}&categoryId=${use.categoryId}`);
    for (const row of rows) assert.equal(row.taxonomy.categoryKey, resolveIngredientTaxonomy(row).categoryKey);
  }
  const after = await captureTables(prisma);
  assert.deepEqual(tableDigests(after), tableDigests(before), 'A read changed copied business data');
  const report = { verifiedAt: new Date().toISOString(), strategy: 'additive_display_taxonomy',
    database: 'isolated_loopback_copy', tablesVerifiedUnchanged: Object.keys(before).length,
    ingredients: before.Ingredient.length, recipeLinks: before.MenuPizzaIngredient.length,
    storeStocks: before.StoreIngredientStock.length, categoryUses: before.IngredientCategoryUse.length,
    reviews: catalog.filter(row => row.taxonomy.reviewRequired).map(row => ({ id: row.id, canonicalKey: row.canonicalKey, categoryKey: row.taxonomy.categoryKey })),
    checks, tableDigests: tableDigests(after) };
  fs.writeFileSync(new URL('../docs/ingredient-taxonomy-v2-projection-verification.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(`Verified ${checks.length} API reads; all ${Object.keys(before).length} copied tables unchanged; ${catalog.length} catalog identities retained.`);
} finally {
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}
