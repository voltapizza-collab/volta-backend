const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values)].sort((a, b) => a - b);

const unavailable = (line, reason, extra = {}) => {
  throw Object.assign(new Error('cart_item_unavailable'), {
    status: 409,
    details: { line: line.name, cartLineId: line.cartLineId, reason, ...extra },
  });
};

// Check the sanitized cart inside the sale transaction (READ COMMITTED). Locks
// remain held until sale creation commits, so a concurrent OFF cannot slip
// between the availability read and the order. Every food reference is checked,
// including rewards and promo components, regardless of its source label.
export async function validateCheckoutAvailability(tx, lines, partnerId, storeId, reference = new Date()) {
  const plans = lines.map(line => {
    const custom = String(line.type || '').toUpperCase() === 'CUSTOM_BUILD' || String(line.cartLineId || '').startsWith('custom-');
    if (custom && (!list(line.ingredients).length && !list(line.customDetails?.ingredients).length)) unavailable(line, 'missing_ingredients');
    if (custom && (line.leftPizzaId || line.rightPizzaId || line.rewardPizzaId || list(line.promoItems).length)) unavailable(line, 'invalid_product');
    const products = [];
    for (const value of [line.pizzaId, line.leftPizzaId, line.rightPizzaId, line.rewardPizzaId, line.customMeta?.basePizzaId]) {
      if (value != null) {
        if (!id(value)) unavailable(line, 'invalid_product');
        products.push({ id: id(value), size: line.size });
      }
    }
    for (const item of list(line.promoItems)) {
      if (!id(item?.pizzaId)) unavailable(line, 'invalid_product');
      products.push({ id: id(item.pizzaId), size: item.size });
    }
    const ingredients = [...list(line.extras), ...list(line.ingredients), ...list(line.customDetails?.ingredients)].map(item => {
      const ingredientId = id(item?.ingredientId ?? item?.id);
      if (!ingredientId) unavailable(line, 'invalid_ingredient');
      return ingredientId;
    });
    const financial = ['COUPON', 'QUEUE_BOOST'].includes(String(line.type || '').toUpperCase()) ||
      ['coupon', 'queue_boost'].includes(String(line.source || '').toLowerCase());
    if (!products.length && (!financial || ingredients.length)) unavailable(line, 'missing_product');
    return { line, products, ingredients, custom };
  });
  const productIds = unique(plans.flatMap(plan => plan.products.map(product => product.id)));
  if (!productIds.length) unavailable(lines[0], 'missing_product');
  const productParams = productIds.map(() => '?').join(',');
  await tx.$queryRawUnsafe(`SELECT id FROM MenuPizza WHERE partnerId = ? AND id IN (${productParams}) ORDER BY id FOR UPDATE`, partnerId, ...productIds);
  await tx.$queryRawUnsafe(`SELECT pizzaId FROM StorePizzaStock WHERE storeId = ? AND pizzaId IN (${productParams}) ORDER BY pizzaId FOR UPDATE`, storeId, ...productIds);
  await tx.$queryRawUnsafe(`SELECT id FROM MenuPizzaIngredient WHERE menuPizzaId IN (${productParams}) ORDER BY id FOR UPDATE`, ...productIds);
  const products = await tx.menuPizza.findMany({
    where: { partnerId, id: { in: productIds } },
    select: { id: true, status: true, type: true, selectSize: true, launchAt: true, availableUntil: true,
      stocks: { where: { storeId }, select: { active: true } },
      ingredients: { select: { ingredientId: true } } },
  });
  const byProduct = new Map(products.map(product => [product.id, product]));
  const recipeProductIds = new Set(plans.filter(plan => !plan.custom).flatMap(plan => plan.products.map(product => product.id)));
  const ingredientIds = unique([...plans.flatMap(plan => plan.ingredients), ...products.filter(product => recipeProductIds.has(product.id)).flatMap(product => product.ingredients.map(row => row.ingredientId))]);
  let ingredients = [];
  if (ingredientIds.length) {
    const params = ingredientIds.map(() => '?').join(',');
    await tx.$queryRawUnsafe(`SELECT id FROM Ingredient WHERE id IN (${params}) ORDER BY id FOR UPDATE`, ...ingredientIds);
    await tx.$queryRawUnsafe(`SELECT ingredientId FROM StoreIngredientStock WHERE storeId = ? AND ingredientId IN (${params}) ORDER BY ingredientId FOR UPDATE`, storeId, ...ingredientIds);
    ingredients = await tx.ingredient.findMany({ where: { id: { in: ingredientIds } },
      select: { id: true, status: true, storeStocks: { where: { storeId }, select: { active: true } } } });
  }
  const byIngredient = new Map(ingredients.map(ingredient => [ingredient.id, ingredient]));
  for (const plan of plans) {
    const requiredIngredients = new Set(plan.ingredients);
    for (const requested of plan.products) {
      const product = byProduct.get(requested.id);
      if (!product || product.status !== 'ACTIVE' || product.type !== 'SELLABLE' || product.stocks[0]?.active !== true ||
        (product.launchAt && new Date(product.launchAt) > reference) ||
        (product.availableUntil && new Date(product.availableUntil) <= reference) ||
        (!plan.custom && !list(product.selectSize).includes(requested.size))) {
        unavailable(plan.line, 'product_unavailable', { pizzaId: requested.id });
      }
      // A custom build uses a category sample only as a pricing reference.
      // Its recipe and sizes are replaced by the customer's explicit selection
      // and category size union; they are not ingredients of this ordered dish.
      if (!plan.custom) for (const row of product.ingredients) requiredIngredients.add(row.ingredientId);
    }
    for (const ingredientId of requiredIngredients) {
      const ingredient = byIngredient.get(ingredientId);
      if (ingredient?.status !== 'ACTIVE' || ingredient.storeStocks[0]?.active !== true) {
        unavailable(plan.line, 'ingredient_unavailable', { ingredientId });
      }
    }
  }
}
