export const foodError = (message, status = 400) => Object.assign(new Error(message), { status });
export const isFoodManaged = partner => partner?.foodConfiguration?.version === 1;
export const packageCategoryIds = config => [...new Set((config?.packages || []).flatMap(p => p.categoryIds || []))];
export const categoryAllowed = (partner, categoryId) => !isFoodManaged(partner) || packageCategoryIds(partner.foodConfiguration).includes(Number(categoryId));
export const categoryBuilder = category => category?.builderType ?? (category?.customizable ? 'PIZZA' : 'NONE');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const sameFoodConfiguration = (left, right) => JSON.stringify(canonical(left ?? null)) === JSON.stringify(canonical(right ?? null));

export function parsePackageIds(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw foodError('invalid_food_packages'); } }
  if (!Array.isArray(value) || value.length > 50 || value.some(id => !Number.isSafeInteger(id) || id <= 0)) throw foodError('invalid_food_packages');
  return [...new Set(value)];
}

export async function snapshotPackages(db, value, previous = null, { allowEmpty = false } = {}) {
  const ids = parsePackageIds(value);
  if (!allowEmpty && !ids.length) throw foodError('food_packages_required');
  const rows = await db.foodPackage.findMany({ where: { id: { in: ids } } });
  const old = new Map((previous?.packages || []).map(p => [p.id, p]));
  const packages = ids.map(id => {
    // Previously selected packages keep their reviewed definition, even if retired.
    if (old.has(id)) return old.get(id);
    const row = rows.find(p => p.id === id);
    if (!row?.active || !row.categoryIds?.length) throw foodError('food_package_unavailable');
    return { id: row.id, name: row.name, categoryIds: row.categoryIds, revision: row.updatedAt.toISOString() };
  });
  const categoryIds = packageCategoryIds({ packages });
  if (categoryIds.length) {
    const categories = await db.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true } });
    if (categories.length !== categoryIds.length) throw foodError('food_package_category_missing', 409);
  }
  return { version: 1, packages };
}

export async function applyFoodConfiguration(tx, partner, configuration, actor = 'global_admin') {
  const allowed = packageCategoryIds(configuration);
  const previousAllowed = isFoodManaged(partner) ? packageCategoryIds(partner.foodConfiguration) : [];
  const categories = await tx.category.findMany({ orderBy: { position: 'asc' } });
  if (allowed.some(id => !categories.some(category => category.id === id))) throw foodError('food_package_category_missing', 409);
  for (const category of categories) {
    const enabled = allowed.includes(category.id);
    // Preserve merchant visibility and base prices for categories that remain assigned.
    const update = enabled && (!isFoodManaged(partner) || previousAllowed.includes(category.id)) ? {} : { enabled };
    await tx.partnerCategory.upsert({ where: { partnerId_categoryId: { partnerId: partner.id, categoryId: category.id } },
      create: { partnerId: partner.id, categoryId: category.id, enabled, position: category.position }, update });
  }
  const next = { ...configuration, updatedAt: new Date().toISOString(), updatedBy: actor };
  await tx.partner.update({ where: { id: partner.id }, data: { foodConfiguration: next } });
  await tx.foodConfigurationChange.create({ data: { partnerId: partner.id, actor, before: partner.foodConfiguration || undefined, after: next } });
  return next;
}

export async function foodAssignmentPreview(db, partner, config) {
  const categories = await db.category.findMany({ orderBy: { position: 'asc' } });
  const links = await db.partnerCategory.findMany({ where: { partnerId: partner.id } });
  const next = packageCategoryIds(config);
  const before = category => links.find(link => link.categoryId === category.id)?.enabled ?? !isFoodManaged(partner);
  const named = list => list.map(c => ({ id: c.id, name: c.name }));
  return { enabled: named(categories.filter(c => next.includes(c.id))),
    added: named(categories.filter(c => next.includes(c.id) && !before(c))),
    disabled: named(categories.filter(c => !next.includes(c.id) && before(c))),
    features: { pizzaBuilder: categories.some(c => next.includes(c.id) && categoryBuilder(c) === 'PIZZA' && c.customizable),
      halfAndHalf: categories.some(c => next.includes(c.id) && c.halfAndHalf) } };
}
