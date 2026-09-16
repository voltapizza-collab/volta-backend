const fail = (message, line) => {
  const error = new Error(message);
  error.status = 400;
  error.details = { line: line?.name || "Pizza" };
  throw error;
};

const supportsRemovals = (line) =>
  Number.isSafeInteger(Number(line?.pizzaId)) && Number(line.pizzaId) > 0 &&
  ["", "SELLABLE"].includes(String(line.type || "").toUpperCase()) &&
  !["promo", "incentive_reward", "coupon", "queue_boost"].includes(String(line.source || "").toLowerCase()) &&
  !line.promoId && !line.promoItems?.length && !line.leftPizzaId && !line.rightPizzaId &&
  !line.leftName && !line.rightName && !line.halfMeta && !line.customMeta && !line.customDetails &&
  !/^(half|promo|custom|reward)-/i.test(String(line.cartLineId || ""));

const readExtras = (value) => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};

// Run before sanitizing the cart: malformed requests must never silently lose a removal.
export async function validateIngredientRemovals(prisma, lines, partnerId, storeId) {
  const requested = lines.filter((line) => line?.removedIngredients != null);
  for (const line of requested) {
    if (!Array.isArray(line.removedIngredients) || line.removedIngredients.length > 100) fail("invalid_ingredient_removals", line);
    if (line.removedIngredients.length && !supportsRemovals(line)) fail("ingredient_removals_not_supported", line);
  }
  const customized = requested.filter((line) => line.removedIngredients.length);
  if (!customized.length) return lines;

  const pizzas = await prisma.menuPizza.findMany({
    where: { id: { in: [...new Set(customized.map((line) => Number(line.pizzaId)))] }, partnerId, type: "SELLABLE", status: "ACTIVE",
      stocks: { some: { storeId, active: true } } },
    select: { id: true, selectSize: true, ingredients: { select: {
      ingredientId: true,
      ingredient: { select: { name: true, canonicalKey: true, status: true } },
    } } },
  });
  const byId = new Map(pizzas.map((pizza) => [pizza.id, pizza]));
  return lines.map((line) => {
    if (!line?.removedIngredients?.length) return line;
    const pizza = byId.get(Number(line.pizzaId));
    if (!pizza || !Array.isArray(pizza.selectSize) || !pizza.selectSize.includes(line.size)) fail("ingredient_removal_unavailable", line);
    const recipe = new Map(pizza.ingredients.map((row) => [row.ingredientId, row]));
    const extras = new Set(readExtras(line.extras).map((extra) => Number(extra?.ingredientId ?? extra?.id)));
    const removed = new Map();
    for (const item of line.removedIngredients) {
      const ingredientId = Number(item?.ingredientId ?? item?.id);
      if (!Number.isSafeInteger(ingredientId) || ingredientId <= 0) fail("invalid_ingredient_removals", line);
      const row = recipe.get(ingredientId);
      // Use the recipe itself, just like the description, even without recorded quantities.
      if (!row || row.ingredient?.status !== "ACTIVE" ||
        String(row.ingredient?.canonicalKey || "").startsWith("random_selection_") ||
        /^random[\s_-]+selection[\s_-]+[123]$/i.test(String(row.ingredient?.name || "").trim())) fail("ingredient_removal_unavailable", line);
      if (extras.has(ingredientId)) fail("ingredient_removal_extra_conflict", line);
      // Names always come from the recipe, never from customer-supplied instructions.
      removed.set(ingredientId, { ingredientId, name: row.ingredient.name });
    }
    return { ...line, removedIngredients: [...removed.values()] };
  });
}
