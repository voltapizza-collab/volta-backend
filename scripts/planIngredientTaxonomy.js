import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPlan } from './lib/ingredientTaxonomyPlan.js';

const master = JSON.parse(fs.readFileSync(new URL('../../volta-storefront/src/data/ingredientMasterSource.json', import.meta.url), 'utf8'));
const plan = buildPlan(master);
const destination = new URL('../docs/ingredient-taxonomy-v2-plan.json', import.meta.url);
fs.writeFileSync(destination, JSON.stringify(plan, null, 2) + '\n');
console.log(JSON.stringify({ file: fileURLToPath(destination), ...plan.counts,
  pending: plan.rows.filter(row => !row.to).map(({ canonicalKey, name, reason }) => ({ canonicalKey, name, reason })) }, null, 2));
