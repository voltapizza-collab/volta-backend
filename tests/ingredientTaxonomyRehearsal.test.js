import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, validatePlan, validateSandboxUrl, bindDatabaseRows, digest } from '../scripts/lib/ingredientTaxonomyPlan.js';
import { verifyForward } from '../scripts/lib/ingredientTaxonomyRehearsal.js';

const master = JSON.parse(fs.readFileSync(new URL('../../volta-storefront/src/data/ingredientMasterSource.json', import.meta.url), 'utf8'));
const plan = buildPlan(master);
const byKey = new Map(plan.rows.map(row => [row.canonicalKey, row]));

test('all current identities are retained exactly once, with explicit review holds', () => {
  assert.equal(plan.rows.length, master.length);
  assert.deepEqual(plan.rows.map(row => row.canonicalKey), master.map(row => row.canonicalKey));
  assert.equal(plan.categories.length, 14);
  assert.equal(plan.counts.proposed + plan.counts.reviewRequired, master.length);
  assert.equal(plan.rows.some(row => row.reason === 'No existe una decisión de clasificación explícita.'), false);
  assert.ok(plan.counts.reviewRequired > 0);
  assert.equal(plan.readyForProduction, false);
  validatePlan(plan, master);
});

test('culinary boundaries distinguish eggs, flour, seeds, spices, fats and prepared sauces', () => {
  const expected = { huevo: 'LACTEOS_HUEVOS', harina_de_cacahuete: 'PANES_MASAS_HARINAS',
    semillas_de_s_samo: 'FRUTOS_SECOS_SEMILLAS', semillas_de_comino: 'SALSAS_CONDIMENTOS_BASES',
    mantequilla: 'ACEITES_GRASAS_VINAGRES', salsa_de_queso: 'SALSAS_CONDIMENTOS_BASES',
    pasta_fresca_de_trigo: 'PASTAS_ARROCES_CEREALES', leche_condensada: 'LACTEOS_HUEVOS',
    tofu: 'LEGUMBRES_PROTEINAS_VEGETALES', algas_nori: 'VERDURAS_SETAS_ALGAS' };
  for (const [key, target] of Object.entries(expected)) assert.equal(byKey.get(key).to.category, target, key);
  for (const key of ['tempura', 'crema_de_cacahuete', 'cigarras']) assert.equal(byKey.get(key).to, null);
});

test('stale source, tampered classification and forged readiness fail closed', () => {
  const alteredMaster = structuredClone(master); alteredMaster[0].aliases.push('new source alias');
  assert.throws(() => validatePlan(plan, alteredMaster), /Master changed/);
  const alteredPlan = structuredClone(plan); alteredPlan.rows[0].to.category = 'QUESOS';
  assert.throws(() => validatePlan(alteredPlan, master), /Manifest differs/);
  const forged = structuredClone(plan); forged.readyForProduction = true;
  assert.throws(() => validatePlan(forged, master), /cannot authorize/);
});

test('remote, default and missing database targets are refused before any connection', () => {
  for (const url of [undefined, 'mysql://user:pass@remote.example/ingredient_taxonomy_rehearsal',
    'mysql://user:pass@127.0.0.1/volta', 'mysql://user:pass@localhost/ingredient_taxonomy_rehearsal?socket=x',
    'postgres://user:pass@localhost/ingredient_taxonomy_rehearsal']) assert.throws(() => validateSandboxUrl(url));
  assert.equal(validateSandboxUrl('mysql://root:pass@127.0.0.1:34000/ingredient_taxonomy_rehearsal'),
    'mysql://root:pass@127.0.0.1:34000/ingredient_taxonomy_rehearsal');
});

test('binding never guesses an identity from a name or rewrites local ingredients', () => {
  const before = [
    { id: 1, name: 'Mozzarella', canonicalKey: 'mozzarella', category: 'QUESOS', semanticCategoryId: 7, isSystem: true },
    { id: 2, name: 'Mozzarella', canonicalKey: 'unknown_key', category: 'QUESOS', semanticCategoryId: 7, isSystem: true },
    { id: 3, canonicalKey: 'mozzarella', category: 'CHEESE', semanticCategoryId: 7, isSystem: false },
    { id: 4, canonicalKey: 'tempura', category: 'OTROS', semanticCategoryId: 1, isSystem: true },
  ];
  const hash = digest(before);
  const result = bindDatabaseRows(plan, master, before);
  assert.deepEqual(result.changes.map(row => row.id), [1]);
  assert.deepEqual(result.local, [3]);
  assert.deepEqual(result.held.map(row => row.reason), ['identity_not_in_master', 'classification_requires_review']);
  assert.equal(digest(before), hash);
});

test('protected identity conflict and duplicate identities cannot be silently reassigned', () => {
  const item = { id: 1, canonicalKey: 'mozzarella', category: 'QUESOS', semanticCategoryId: 7, isSystem: true };
  const result = bindDatabaseRows(plan, master, [item], [{ ingredientId: 1, masterCanonicalKey: 'huevo' }]);
  assert.equal(result.changes.length, 0);
  assert.equal(result.held[0].reason, 'identity_conflict');
  assert.throws(() => bindDatabaseRows(plan, master, [item, { ...item, id: 2 }]), /Two database ingredients/);
});

test('existing explicit legacy redirects preserve ingredient ID and canonical key', () => {
  const source = master.find(row => row.legacyCanonicalKeys?.length && byKey.get(row.canonicalKey).to);
  assert.ok(source);
  const ingredient = { id: 91, canonicalKey: source.legacyCanonicalKeys[0], category: source.category, semanticCategoryId: 5, isSystem: true };
  const result = bindDatabaseRows(plan, master, [ingredient]);
  assert.equal(result.changes[0].id, 91);
  assert.equal(result.changes[0].canonicalKey, source.canonicalKey);
  assert.equal(ingredient.canonicalKey, source.legacyCanonicalKeys[0]);
});

test('reviewed English keys change classification only; operational placeholders and ambiguous compositions are held', () => {
  const ingredients = [
    { id: 1, canonicalKey: 'cooked_ham', category: 'EMBUTIDOS', semanticCategoryId: 7, isSystem: true },
    { id: 2, canonicalKey: 'random_selection_1', category: 'Random selection', semanticCategoryId: null, isSystem: true },
    { id: 3, canonicalKey: 'turkey', category: 'EMBUTIDOS', semanticCategoryId: 7, isSystem: true },
    { id: 4, canonicalKey: 'condensed_milk', category: 'QUESOS', semanticCategoryId: 7, isSystem: true },
  ];
  const result = bindDatabaseRows(plan, master, ingredients);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].canonicalKey, 'cooked_ham', 'Classification decisions are not identity redirects');
  assert.deepEqual(result.operational, [2]);
  assert.deepEqual(result.held.map(row => row.reason), ['legacy_composition_requires_review', 'legacy_classification_drift']);
});

const fixture = () => ({
  Ingredient: [{ id: 1, canonicalKey: 'huevo', category: 'OTROS', semanticCategoryId: 7, costPrice: 0.8, allergens: ['egg'], image: 'saved' }],
  IngredientSemanticCategory: [{ id: 7, canonicalKey: 'other' }],
  MenuPizzaIngredient: [{ id: 1, ingredientId: 1, menuPizzaId: 4, qtyBySize: { M: 2 } }],
  StoreIngredientStock: [{ storeId: 3, ingredientId: 1, stock: 12, active: true }],
  IngredientExtra: [{ id: 8, ingredientId: 1, priceBySize: { M: 2.5 } }],
  Sale: [{ id: 1, products: [{ ingredientId: 1 }], total: 18 }],
});
test('verification detects changes to prices, recipes, stock, orders and ingredient metadata', () => {
  const before = fixture();
  const after = structuredClone(before);
  after.Ingredient[0].category = 'LACTEOS_HUEVOS'; after.Ingredient[0].semanticCategoryId = 8;
  after.IngredientSemanticCategory.push({ id: 8, canonicalKey: 'restaurant_v2_dairy_eggs' });
  const changes = [{ id: 1, to: { category: 'LACTEOS_HUEVOS', semanticKey: 'restaurant_v2_dairy_eggs' } }];
  const created = new Map([['restaurant_v2_dairy_eggs', 8]]);
  verifyForward(before, after, changes, created);
  for (const [table, field, value] of [['Ingredient', 'costPrice', 99], ['Ingredient', 'allergens', []],
    ['MenuPizzaIngredient', 'qtyBySize', { M: 0 }], ['StoreIngredientStock', 'stock', 0],
    ['IngredientExtra', 'priceBySize', { M: 100 }], ['Sale', 'total', 19]]) {
    const corrupt = structuredClone(after); corrupt[table][0][field] = value;
    assert.throws(() => verifyForward(before, corrupt, changes, created), undefined, `${table}.${field}`);
  }
});
