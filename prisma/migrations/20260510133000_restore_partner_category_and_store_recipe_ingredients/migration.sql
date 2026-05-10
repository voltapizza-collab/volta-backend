CREATE TABLE IF NOT EXISTS `PartnerCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partnerId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PartnerCategory_partnerId_categoryId_key`(`partnerId`, `categoryId`),
    INDEX `PartnerCategory_partnerId_position_idx`(`partnerId`, `position`),
    INDEX `PartnerCategory_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @partnerCategoryPartnerFk := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'PartnerCategory'
    AND CONSTRAINT_NAME = 'PartnerCategory_partnerId_fkey'
);

SET @partnerCategoryPartnerSql := IF(
  @partnerCategoryPartnerFk = 0,
  'ALTER TABLE `PartnerCategory` ADD CONSTRAINT `PartnerCategory_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);

PREPARE partnerCategoryPartnerStmt FROM @partnerCategoryPartnerSql;
EXECUTE partnerCategoryPartnerStmt;
DEALLOCATE PREPARE partnerCategoryPartnerStmt;

SET @partnerCategoryCategoryFk := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'PartnerCategory'
    AND CONSTRAINT_NAME = 'PartnerCategory_categoryId_fkey'
);

SET @partnerCategoryCategorySql := IF(
  @partnerCategoryCategoryFk = 0,
  'ALTER TABLE `PartnerCategory` ADD CONSTRAINT `PartnerCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);

PREPARE partnerCategoryCategoryStmt FROM @partnerCategoryCategorySql;
EXECUTE partnerCategoryCategoryStmt;
DEALLOCATE PREPARE partnerCategoryCategoryStmt;

INSERT IGNORE INTO `PartnerCategory` (
  `partnerId`,
  `categoryId`,
  `enabled`,
  `position`,
  `createdAt`,
  `updatedAt`
)
SELECT
  p.`id`,
  c.`id`,
  true,
  c.`position`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `Partner` p
CROSS JOIN `Category` c;

INSERT IGNORE INTO `StoreIngredientStock` (
  `storeId`,
  `ingredientId`,
  `stock`,
  `active`,
  `createdAt`,
  `updatedAt`
)
SELECT DISTINCT
  s.`id`,
  mpi.`ingredientId`,
  0,
  true,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `Store` s
INNER JOIN `MenuPizza` mp
  ON mp.`partnerId` = s.`partnerId`
INNER JOIN `MenuPizzaIngredient` mpi
  ON mpi.`menuPizzaId` = mp.`id`
INNER JOIN `Ingredient` i
  ON i.`id` = mpi.`ingredientId`
WHERE mp.`status` = 'ACTIVE'
  AND mp.`type` = 'SELLABLE'
  AND i.`status` = 'ACTIVE';

UPDATE `StoreIngredientStock` sis
INNER JOIN (
  SELECT DISTINCT
    s.`id` AS `storeId`,
    mpi.`ingredientId`
  FROM `Store` s
  INNER JOIN `MenuPizza` mp
    ON mp.`partnerId` = s.`partnerId`
  INNER JOIN `MenuPizzaIngredient` mpi
    ON mpi.`menuPizzaId` = mp.`id`
  INNER JOIN `Ingredient` i
    ON i.`id` = mpi.`ingredientId`
  WHERE mp.`status` = 'ACTIVE'
    AND mp.`type` = 'SELLABLE'
    AND i.`status` = 'ACTIVE'
) recipe_ingredient
  ON recipe_ingredient.`storeId` = sis.`storeId`
  AND recipe_ingredient.`ingredientId` = sis.`ingredientId`
SET sis.`active` = true;
