import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveIngredientTaxonomy, getTaxonomyCategories, getTaxonomyCategoryLabel } from '../services/ingredientTaxonomy.js';
import { resolveIngredientDisplay } from '../services/ingredientSemantics.js';
import { normalizeIngredientOnboarding } from '../services/ingredientOnboarding.js';
import { resolveSemanticCategoryKey } from '../services/ingredientSemanticCategoryMap.js';
import { decisionFor } from '../scripts/lib/ingredientTaxonomyRules.js';

const master = JSON.parse(fs.readFileSync(new URL('../data/ingredientMasterCatalogue.json', import.meta.url)));
const taxonomy = JSON.parse(fs.readFileSync(new URL('../data/ingredientTaxonomy.json', import.meta.url)));
const classify = (canonicalKey, category, other = {}) => resolveIngredientTaxonomy({ canonicalKey, category, ...other });

test('all master identities have one restaurant family, preserving the original catalogue', () => {
  const before = JSON.stringify(master);
  const keys = new Set(getTaxonomyCategories().map(row => row.key));
  assert.equal(keys.size, 14);
  const protectedKeys = JSON.parse(fs.readFileSync(new URL('../../volta-storefront/docs/ingredient-master-protected-keys.json', import.meta.url))).keys;
  assert.ok(master.length >= protectedKeys.length);
  for (const key of protectedKeys) assert.ok(master.some(row => row.canonicalKey === key), key);
  for (const row of master) assert.ok(keys.has(resolveIngredientTaxonomy(row).categoryKey), row.canonicalKey);
  assert.equal(JSON.stringify(master), before);
  assert.deepEqual(Object.keys(taxonomy.assignments).sort(), master.map(row => row.canonicalKey).sort());
});

test('reviewed restaurant additions leave historical storage categories intact and reject unknown families', () => {
  const original = {canonicalKey:'pasta_rigatoni',category:'OTROS',restaurantCategoryKey:'PASTAS_ARROCES_CEREALES'};
  const input = structuredClone(original);
  assert.equal(decisionFor(input).category, 'PASTAS_ARROCES_CEREALES');
  assert.deepEqual(input, original);
  assert.throws(() => decisionFor({...input,restaurantCategoryKey:'UNREVIEWED_FAMILY'}), /Unknown restaurant family/);
});

test('identity splits the former catch-all category without using names', () => {
  for (const key of ['PANES_MASAS_HARINAS', 'PASTAS_ARROCES_CEREALES', 'LACTEOS_HUEVOS', 'LEGUMBRES_PROTEINAS_VEGETALES', 'FRUTOS_SECOS_SEMILLAS']) {
    const row = master.find(item => item.category === 'OTROS' && taxonomy.assignments[item.canonicalKey].categoryKey === key);
    assert.ok(row, key);
    assert.equal(resolveIngredientTaxonomy({ ...row, name: 'Nombre editado' }).categoryKey, key);
  }
  assert.equal(classify(null, 'OTROS', { name: 'Pan de hamburguesa' }).categoryKey, 'UNCLASSIFIED');
  assert.equal(classify('bread_unknown', 'OTROS', { name: 'Pan de hamburguesa' }).reviewRequired, true);
});

test('legacy English identities, retired keys and protected master keys remain recognizable', () => {
  assert.equal(classify('turkey', 'EMBUTIDOS').categoryKey, 'EMBUTIDOS_CHARCUTERIA');
  assert.equal(classify('turkey', 'EMBUTIDOS').reviewRequired, true);
  for (const [old, current] of Object.entries(taxonomy.redirects)) {
    assert.equal(classify(old, 'OTROS').categoryKey, classify(current, 'OTROS').categoryKey);
  }
  const key = Object.keys(taxonomy.assignments)[0];
  assert.equal(classify('renamed', 'OTROS', { catalogState: { masterCanonicalKey: key } }).categoryKey, taxonomy.assignments[key].categoryKey);
});

test('local ingredients cannot acquire the classification of an unrelated global canonical key', () => {
  assert.equal(classify('pollo_frito', 'QUESOS', { isSystem: false }).categoryKey, 'QUESOS');
  assert.equal(classify('pollo_frito', 'QUESOS', { isSystem: 0 }).categoryKey, 'QUESOS');
  assert.equal(classify(null, 'PANES_MASAS_HARINAS', { isSystem: false }).categoryKey, 'PANES_MASAS_HARINAS');
});

test('operational records stay outside the fourteen food families and ambiguity stays visible', () => {
  for (const key of taxonomy.operationalKeys) assert.equal(classify(key, 'Random selection').categoryKey, 'OPERATIONAL');
  for (const key of ['tempura', 'crema_de_avellanas', 'crema_de_cacahuete', 'crema_de_pistacho']) {
    assert.equal(classify(key, 'OTROS').reviewRequired, true, key);
  }
  assert.equal(classify(null, 'QUESOS').reviewRequired, true);
  assert.equal(classify('__proto__', '__proto__').categoryKey, 'UNCLASSIFIED');
});

test('every family has seven translations and regional locale fallback', () => {
  for (const locale of ['es', 'en', 'it', 'fr', 'pt', 'ar', 'zh']) {
    for (const row of getTaxonomyCategories(locale)) assert.ok(row.label && row.label !== row.key, `${locale}: ${row.key}`);
  }
  assert.equal(getTaxonomyCategoryLabel('PANES_MASAS_HARINAS', 'en-GB'), getTaxonomyCategoryLabel('PANES_MASAS_HARINAS', 'en'));
});

test('new display grouping does not change semantic search, financial fields or existing associations', () => {
  const input = { id: 41, name: 'Pasta', canonicalKey: 'pasta_unknown', category: 'OTROS', isSystem: true,
    costPrice: 1.75, extraPrice: 2.5, stock: 80, semanticCategoryId: 13, allergens: ['GLUTEN'] };
  const before = structuredClone(input);
  const result = resolveIngredientDisplay(input);
  assert.equal(result.displayCategory, 'Otros');
  assert.equal(result.searchText, 'pasta pasta unknown otros');
  assert.equal(result.taxonomy.categoryKey, 'UNCLASSIFIED');
  assert.deepEqual(input, before);
});

test('new category requests use existing semantic families while legacy requests stay identical', () => {
  const input = { name: 'Pan de prueba', canonicalKey: 'pan_de_prueba', category: 'PANES_MASAS_HARINAS',
    translations: ['es', 'en', 'it', 'fr', 'pt', 'ar', 'zh'].map(locale => ({ locale, name: 'Pan de prueba' })) };
  const normalized = normalizeIngredientOnboarding(input);
  assert.equal(normalized.category, 'PANES_MASAS_HARINAS');
  assert.equal(normalized.semanticCategoryKey, 'other');
  for (const row of getTaxonomyCategories()) assert.ok(resolveSemanticCategoryKey(row.key), row.key);
  assert.equal(normalizeIngredientOnboarding({ ...input, category: 'AROMAS_Y_EXTRACTOS' }).semanticCategoryKey, 'extras');
  assert.equal(resolveSemanticCategoryKey('AROMAS_Y_EXTRACTOS'), 'herbs_spices');
});
