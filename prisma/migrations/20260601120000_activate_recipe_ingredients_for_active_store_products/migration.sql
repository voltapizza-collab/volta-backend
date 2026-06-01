INSERT IGNORE INTO `StoreIngredientStock` (
  `storeId`,
  `ingredientId`,
  `stock`,
  `active`,
  `createdAt`,
  `updatedAt`
)
SELECT DISTINCT
  sps.`storeId`,
  mpi.`ingredientId`,
  0,
  true,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `StorePizzaStock` sps
INNER JOIN `MenuPizza` mp
  ON mp.`id` = sps.`pizzaId`
INNER JOIN `MenuPizzaIngredient` mpi
  ON mpi.`menuPizzaId` = mp.`id`
INNER JOIN `Ingredient` i
  ON i.`id` = mpi.`ingredientId`
WHERE sps.`active` = true
  AND mp.`status` = 'ACTIVE'
  AND mp.`type` = 'SELLABLE'
  AND i.`status` = 'ACTIVE'
  AND i.`costPrice` > 0;

UPDATE `StoreIngredientStock` sis
INNER JOIN (
  SELECT DISTINCT
    sps.`storeId`,
    mpi.`ingredientId`
  FROM `StorePizzaStock` sps
  INNER JOIN `MenuPizza` mp
    ON mp.`id` = sps.`pizzaId`
  INNER JOIN `MenuPizzaIngredient` mpi
    ON mpi.`menuPizzaId` = mp.`id`
  INNER JOIN `Ingredient` i
    ON i.`id` = mpi.`ingredientId`
  WHERE sps.`active` = true
    AND mp.`status` = 'ACTIVE'
    AND mp.`type` = 'SELLABLE'
    AND i.`status` = 'ACTIVE'
    AND i.`costPrice` > 0
) recipe_ingredient
  ON recipe_ingredient.`storeId` = sis.`storeId`
  AND recipe_ingredient.`ingredientId` = sis.`ingredientId`
SET sis.`active` = true;
