import fs from 'node:fs';
import { createTaxonomyResolver } from '../data/ingredientTaxonomyResolver.js';
const data = JSON.parse(fs.readFileSync(new URL('../data/ingredientTaxonomy.json', import.meta.url), 'utf8'));
export const { resolveIngredientTaxonomy, getIngredientTaxonomyKey, getTaxonomyCategoryLabel, getTaxonomyCategories, getLegacyIngredientCategory } = createTaxonomyResolver(data);
