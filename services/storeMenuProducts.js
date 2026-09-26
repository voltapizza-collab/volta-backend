const json = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

// One round trip instead of fetching each level of the recipe/stock graph.
// Availability is read on every call; no ingredient or product state is cached.
export async function loadStoreMenuProducts(prisma, partnerId, storeId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.name, p.category, p.categoryId, p.cookingMethod, p.selectSize,
           p.priceBySize, p.image, p.launchAt, p.availableUntil, p.productTags,
           c.position, c.customizable, c.halfAndHalf,
           s.active AS productActive, s.stock,
           r.id AS recipeId, r.qtyBySize,
           i.id AS ingredientId, i.name AS ingredientName, i.canonicalKey,
           i.allergens, i.costPrice, i.status AS ingredientStatus, t.active AS ingredientActive
      FROM MenuPizza p
      LEFT JOIN Category c ON c.id = p.categoryId
      LEFT JOIN StorePizzaStock s ON s.pizzaId = p.id AND s.storeId = ?
      LEFT JOIN MenuPizzaIngredient r ON r.menuPizzaId = p.id
      LEFT JOIN Ingredient i ON i.id = r.ingredientId
      LEFT JOIN StoreIngredientStock t ON t.ingredientId = i.id AND t.storeId = ?
     WHERE p.partnerId = ? AND p.status = 'ACTIVE' AND p.type = 'SELLABLE'
     ORDER BY p.id, r.id`, storeId, storeId, partnerId);
  const products = new Map();
  for (const row of rows) {
    if (!products.has(row.id)) products.set(row.id, {
      id: row.id, name: row.name, category: row.category, categoryId: row.categoryId,
      cookingMethod: row.cookingMethod, selectSize: json(row.selectSize, []),
      priceBySize: json(row.priceBySize, {}), image: row.image, launchAt: row.launchAt,
      availableUntil: row.availableUntil, productTags: json(row.productTags, []),
      categoryRef: { position: row.position, customizable: Boolean(row.customizable), halfAndHalf: Boolean(row.halfAndHalf) },
      stocks: row.productActive == null ? [] : [{ active: Boolean(row.productActive), stock: row.stock }],
      ingredients: [],
    });
    if (row.recipeId != null) products.get(row.id).ingredients.push({
      qtyBySize: json(row.qtyBySize, {}), ingredient: {
        id: row.ingredientId, name: row.ingredientName, canonicalKey: row.canonicalKey,
        allergens: json(row.allergens, []), costPrice: row.costPrice, status: row.ingredientStatus,
        storeStocks: row.ingredientActive == null ? [] : [{ active: Boolean(row.ingredientActive) }],
      },
    });
  }
  return [...products.values()];
}
