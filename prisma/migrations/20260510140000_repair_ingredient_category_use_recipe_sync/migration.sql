INSERT INTO IngredientCategoryUse (
  ingredientId,
  partnerId,
  categoryId,
  costPrice,
  active,
  createdAt,
  updatedAt
)
SELECT DISTINCT
  mpi.ingredientId,
  mp.partnerId,
  mp.categoryId,
  i.costPrice,
  TRUE,
  NOW(),
  NOW()
FROM MenuPizzaIngredient mpi
JOIN MenuPizza mp
  ON mp.id = mpi.menuPizzaId
JOIN Ingredient i
  ON i.id = mpi.ingredientId
WHERE mp.status = 'ACTIVE'
  AND mp.type = 'SELLABLE'
  AND mp.categoryId IS NOT NULL
  AND i.status = 'ACTIVE'
ON DUPLICATE KEY UPDATE
  active = TRUE,
  costPrice = COALESCE(IngredientCategoryUse.costPrice, VALUES(costPrice)),
  updatedAt = NOW();

DELETE icu
FROM IngredientCategoryUse icu
WHERE NOT EXISTS (
  SELECT 1
  FROM MenuPizzaIngredient mpi
  JOIN MenuPizza mp
    ON mp.id = mpi.menuPizzaId
  JOIN Ingredient i
    ON i.id = mpi.ingredientId
  WHERE mpi.ingredientId = icu.ingredientId
    AND mp.partnerId = icu.partnerId
    AND mp.categoryId = icu.categoryId
    AND mp.status = 'ACTIVE'
    AND mp.type = 'SELLABLE'
    AND i.status = 'ACTIVE'
);
