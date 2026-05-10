INSERT IGNORE INTO `IngredientCategoryUse` (
  `ingredientId`,
  `partnerId`,
  `categoryId`,
  `costPrice`,
  `active`,
  `createdAt`,
  `updatedAt`
)
SELECT DISTINCT
  mpi.`ingredientId`,
  mp.`partnerId`,
  mp.`categoryId`,
  i.`costPrice`,
  true,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `MenuPizzaIngredient` mpi
INNER JOIN `MenuPizza` mp ON mp.`id` = mpi.`menuPizzaId`
INNER JOIN `Ingredient` i ON i.`id` = mpi.`ingredientId`
WHERE mp.`categoryId` IS NOT NULL
  AND mp.`partnerId` IS NOT NULL
  AND mp.`type` = 'SELLABLE';

UPDATE `IngredientCategoryUse` icu
INNER JOIN (
  SELECT DISTINCT
    mpi.`ingredientId`,
    mp.`partnerId`,
    mp.`categoryId`
  FROM `MenuPizzaIngredient` mpi
  INNER JOIN `MenuPizza` mp ON mp.`id` = mpi.`menuPizzaId`
  WHERE mp.`categoryId` IS NOT NULL
    AND mp.`partnerId` IS NOT NULL
    AND mp.`type` = 'SELLABLE'
) recipe_use
  ON recipe_use.`ingredientId` = icu.`ingredientId`
  AND recipe_use.`partnerId` = icu.`partnerId`
  AND recipe_use.`categoryId` = icu.`categoryId`
SET icu.`active` = true;
