const normalizePositiveIds = (values) => [
  ...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  ),
];

const throwRequestError = (message, status = 400, extra = {}) => {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  throw error;
};

export const ensureStoresBelongToPartner = async (
  prisma,
  { partnerId, storeIds }
) => {
  const targetStoreIds = normalizePositiveIds(storeIds);

  if (!targetStoreIds.length) return [];

  const stores = await prisma.store.findMany({
    where: {
      id: { in: targetStoreIds },
      partnerId,
    },
    select: { id: true },
  });

  const validIds = new Set(stores.map((store) => store.id));
  const missingIds = targetStoreIds.filter((id) => !validIds.has(id));

  if (missingIds.length) {
    throwRequestError("Store not found for partner", 404, { storeIds: missingIds });
  }

  return targetStoreIds;
};

export const assertIngredientsCanBeActivated = async (prisma, ingredientIds) => {
  const targetIngredientIds = normalizePositiveIds(ingredientIds);

  if (!targetIngredientIds.length) return [];

  const activeIngredients = await prisma.ingredient.findMany({
    where: {
      id: { in: targetIngredientIds },
      status: "ACTIVE",
      costPrice: { gt: 0 },
    },
    select: { id: true },
  });

  const activeIds = new Set(activeIngredients.map((ingredient) => ingredient.id));
  const blockedIds = targetIngredientIds.filter((id) => !activeIds.has(id));

  if (blockedIds.length) {
    throwRequestError(
      "Ingredients must be active and priced before store activation",
      400,
      { ingredientIds: blockedIds }
    );
  }

  return targetIngredientIds;
};

export const ensureStoreIngredientsActive = async (
  prisma,
  { storeIds, ingredientIds }
) => {
  const targetStoreIds = normalizePositiveIds(storeIds);
  const targetIngredientIds = await assertIngredientsCanBeActivated(
    prisma,
    ingredientIds
  );

  if (!targetStoreIds.length || !targetIngredientIds.length) return;

  await Promise.all(
    targetStoreIds.flatMap((storeId) =>
      targetIngredientIds.map((ingredientId) =>
        prisma.storeIngredientStock.upsert({
          where: {
            storeId_ingredientId: {
              storeId,
              ingredientId,
            },
          },
          update: {
            active: true,
          },
          create: {
            storeId,
            ingredientId,
            stock: 0,
            active: true,
          },
        })
      )
    )
  );
};
