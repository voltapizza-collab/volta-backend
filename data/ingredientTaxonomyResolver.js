// Shared pure resolver. Copied verbatim to the storefront by buildIngredientTaxonomy.js.
// This is display organization, not identity, allergen, matching or pricing logic.
export function createTaxonomyResolver(data) {
  const categories = new Map(data.categories.map(row => [row.key, row]));
  const normalize = value => String(value || '').trim().toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const localeOf = value => String(value || 'es').toLowerCase().split(/[-_]/)[0];
  const getTaxonomyCategoryLabel = (key, locale = 'es') => {
    const labels = categories.get(key)?.labels || data.specialLabels[key];
    return labels?.[localeOf(locale)] || labels?.es || key || data.specialLabels.UNCLASSIFIED.es;
  };
  function resolveIngredientTaxonomy(ingredient = {}, locale = 'es') {
    const rawCategory = normalize(ingredient.category);
    const global = ingredient.isSystem !== false && ingredient.isSystem !== 0;
    const originalKey = global ? (ingredient.catalogState?.masterCanonicalKey || ingredient.masterCanonicalKey || ingredient.canonicalKey) : null;
    const key = Object.hasOwn(data.redirects, originalKey) ? data.redirects[originalKey] : originalKey;
    let assignment;
    let source = 'legacy_category';
    if (global && data.operationalKeys.includes(key) && rawCategory === 'RANDOM_SELECTION') {
      assignment = { categoryKey: 'OPERATIONAL', reviewRequired: false }; source = 'operational';
    } else if (global && Object.hasOwn(data.assignments, key)) {
      assignment = data.assignments[key]; source = 'master';
    } else if (global && Object.hasOwn(data.legacyAssignments, key) && normalize(data.legacyAssignments[key].from) === rawCategory) {
      assignment = data.legacyAssignments[key]; source = 'legacy_identity';
    } else if (categories.has(rawCategory)) {
      assignment = { categoryKey: rawCategory, reviewRequired: Boolean(global && !originalKey) }; source = 'explicit_category';
    } else {
      assignment = { categoryKey: Object.hasOwn(data.legacyCategories, rawCategory) ? data.legacyCategories[rawCategory] : 'UNCLASSIFIED',
        reviewRequired: Boolean(global && (!originalKey || Object.hasOwn(data.legacyAssignments, key))) };
    }
    const categoryKey = assignment.categoryKey;
    return { version: data.version, categoryKey, label: getTaxonomyCategoryLabel(categoryKey, locale),
      reviewRequired: assignment.reviewRequired === true || categoryKey === 'UNCLASSIFIED', source };
  }
  const getIngredientTaxonomyKey = ingredient => resolveIngredientTaxonomy(ingredient).categoryKey;
  const getLegacyIngredientCategory = value => {
    const key = normalize(value);
    return Object.hasOwn(data.legacyWriteCategories, key) ? data.legacyWriteCategories[key] : key;
  };
  const getTaxonomyCategories = (locale = 'es') => data.categories.map(row => ({ key: row.key, label: getTaxonomyCategoryLabel(row.key, locale) }));
  return { resolveIngredientTaxonomy, getIngredientTaxonomyKey, getTaxonomyCategoryLabel, getTaxonomyCategories, getLegacyIngredientCategory };
}
