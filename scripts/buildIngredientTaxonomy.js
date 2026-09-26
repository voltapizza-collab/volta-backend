import fs from 'node:fs';
import assert from 'node:assert/strict';
import { categories, legacyDefaults, decisionFor } from './lib/ingredientTaxonomyRules.js';
import { legacyDatabaseClassifications, legacyDatabaseReviews, operationalKeys } from './lib/ingredientTaxonomyLegacyDatabase.js';
import { labels, locales } from './lib/ingredientTaxonomyLabels.js';
import { digest } from './lib/ingredientTaxonomyPlan.js';

const master = JSON.parse(fs.readFileSync(new URL('../../volta-storefront/src/data/ingredientMasterSource.json', import.meta.url), 'utf8'));
// These four identities now fit the explicitly broadened animal-protein family.
const animalProteins = new Set(['caracoles_malteses', 'escargots_de_bourgogne', 'cigarras', 'gusanos_mopani']);
const assignments = {}, redirects = {};
for (const row of master) {
  const decision = decisionFor(row);
  assignments[row.canonicalKey] = {
    categoryKey: decision.category || (animalProteins.has(row.canonicalKey) ? 'CARNES_AVES' : row.canonicalKey === 'tempura' ? 'PANES_MASAS_HARINAS' : legacyDefaults[row.category]),
    reviewRequired: !decision.category && !animalProteins.has(row.canonicalKey),
  };
  assert.ok(categories.some(category => category.key === assignments[row.canonicalKey].categoryKey), `Missing category: ${row.canonicalKey}`);
  for (const old of row.legacyCanonicalKeys || []) redirects[old] = row.canonicalKey;
}
const legacyAssignments = Object.fromEntries([...legacyDatabaseClassifications].map(([key, row]) => [key, { from: row.from, categoryKey: row.to, reviewRequired: false }]));
for (const [key] of legacyDatabaseReviews) legacyAssignments[key] = {
  from: key === 'turkey' ? 'EMBUTIDOS' : 'CREMAS_DULCES',
  categoryKey: key === 'turkey' ? 'EMBUTIDOS_CHARCUTERIA' : 'REPOSTERIA_AUXILIARES', reviewRequired: true,
};
const translated = key => Object.fromEntries(locales.map((locale, index) => [locale, labels[key][index]]));
const data = { version: 'restaurant-v2-2026-09-18', sourceSha256: digest(master),
  categories: categories.map(row => ({ key: row.key, labels: translated(row.key), position: row.position })),
  specialLabels: { UNCLASSIFIED: translated('UNCLASSIFIED'), OPERATIONAL: translated('OPERATIONAL') },
  legacyWriteCategories: { CARNES_AVES: 'CARNES', EMBUTIDOS_CHARCUTERIA: 'EMBUTIDOS', PESCADOS_Y_MARISCOS: 'PESCADOS_Y_MARISCOS',
    QUESOS: 'QUESOS', LACTEOS_HUEVOS: 'OTROS', VERDURAS_SETAS_ALGAS: 'VERDURAS', FRUTAS: 'FRUTAS',
    LEGUMBRES_PROTEINAS_VEGETALES: 'OTROS', PASTAS_ARROCES_CEREALES: 'OTROS', PANES_MASAS_HARINAS: 'OTROS',
    FRUTOS_SECOS_SEMILLAS: 'OTROS', ACEITES_GRASAS_VINAGRES: 'ACEITES_GRASAS_VINAGRES',
    SALSAS_CONDIMENTOS_BASES: 'SALSAS', REPOSTERIA_AUXILIARES: 'CREMAS_DULCES' },
  legacyCategories: { ...legacyDefaults, AROMAS_Y_EXTRACTOS: 'SALSAS_CONDIMENTOS_BASES',
    ACEITES: 'ACEITES_GRASAS_VINAGRES', ESPECIAS: 'SALSAS_CONDIMENTOS_BASES', SALSAS_CREMAS: 'SALSAS_CONDIMENTOS_BASES',
    FIAMBRES: 'EMBUTIDOS_CHARCUTERIA', MARISCOS: 'PESCADOS_Y_MARISCOS', PESCADOS: 'PESCADOS_Y_MARISCOS', DEL_MAR: 'PESCADOS_Y_MARISCOS',
    CHEESE: 'QUESOS', SAUCE: 'SALSAS_CONDIMENTOS_BASES', SAUCES: 'SALSAS_CONDIMENTOS_BASES',
    VEGETABLE: 'VERDURAS_SETAS_ALGAS', VEGETALES: 'VERDURAS_SETAS_ALGAS', PROTEIN: 'CARNES_AVES',
    PROTEINA_VEGANA: 'LEGUMBRES_PROTEINAS_VEGETALES', FRUTOS_SECOS_Y_SEMILLAS: 'FRUTOS_SECOS_SEMILLAS',
    EXTRAS: 'REPOSTERIA_AUXILIARES', TOPPINGS_DULCES: 'REPOSTERIA_AUXILIARES' },
  operationalKeys: [...operationalKeys], assignments, redirects, legacyAssignments };
const output = JSON.stringify(data, null, 2) + '\n';
fs.writeFileSync(new URL('../data/ingredientTaxonomy.json', import.meta.url), output);
fs.writeFileSync(new URL('../../volta-storefront/src/data/ingredientTaxonomy.json', import.meta.url), output);
fs.copyFileSync(new URL('../data/ingredientTaxonomyResolver.js', import.meta.url), new URL('../../volta-storefront/src/data/ingredientTaxonomyResolver.js', import.meta.url));
console.log(`Taxonomy built: ${master.length} identities, ${categories.length} categories, ${Object.values(assignments).filter(row => row.reviewRequired).length} provisional classifications; existing master unchanged.`);
