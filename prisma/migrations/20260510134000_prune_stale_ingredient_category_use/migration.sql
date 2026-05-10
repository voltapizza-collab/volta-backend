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
WHERE mp.id IS NULL;
