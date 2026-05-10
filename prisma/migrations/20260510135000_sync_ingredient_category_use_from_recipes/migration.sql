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
LEFT JOIN MenuPizzaIngredient mpi
  ON mpi.ingredientId = icu.ingredientId
LEFT JOIN MenuPizza mp
  ON mp.id = mpi.menuPizzaId
 AND mp.partnerId = icu.partnerId
 AND mp.categoryId = icu.categoryId
 AND mp.status = 'ACTIVE'
 AND mp.type = 'SELLABLE'
LEFT JOIN Ingredient i
  ON i.id = icu.ingredientId
 AND i.status = 'ACTIVE'
WHERE mp.id IS NULL
   OR i.id IS NULL;
