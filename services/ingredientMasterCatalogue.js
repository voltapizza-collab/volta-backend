import fs from 'node:fs';
import { normalizeSearchText } from './ingredientSemantics.js';
import { ingredientMasterIdentityRules } from '../data/ingredientMasterIdentityRules.js';

// A versioned server-side reference. No HTTP handler writes this file.
const master = JSON.parse(fs.readFileSync(new URL('../data/ingredientMasterCatalogue.json', import.meta.url), 'utf8'));
for (const row of master) { Object.freeze(row.aliases); if (row.legacyCanonicalKeys) Object.freeze(row.legacyCanonicalKeys); Object.freeze(row); }
const byKey = new Map(master.map(row => [row.canonicalKey, row]));
const byName = new Map();
for (const row of master) {
  for (const name of [row.defaultName, ...row.aliases]) byName.set(normalizeSearchText(name), row);
}
export const getMasterIngredient = key => byKey.get(ingredientMasterIdentityRules.redirects[key] || key);
export const findMasterIngredient = ingredient => {
  const direct = getMasterIngredient(ingredient.catalogState?.masterCanonicalKey || ingredient.canonicalKey);
  if (direct) return direct;
  const matches = [ingredient.name, ...(ingredient.translations || []).filter(row => row.locale === 'es').map(row => row.name),
    ...(ingredient.aliases || []).map(row => row.alias)].map(name => byName.get(normalizeSearchText(name))).filter(Boolean);
  return new Set(matches.map(row => row.canonicalKey)).size === 1 ? matches[0] : null;
};
