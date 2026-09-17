CREATE TABLE `IngredientCatalogState` (
  `ingredientId` INTEGER NOT NULL,
  `masterCanonicalKey` VARCHAR(120) NOT NULL,
  `archivedAt` DATETIME(3) NULL,
  `previousStatus` VARCHAR(20) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`ingredientId`),
  INDEX `IngredientCatalogState_masterCanonicalKey_idx` (`masterCanonicalKey`),
  INDEX `IngredientCatalogState_archivedAt_idx` (`archivedAt`),
  CONSTRAINT `IngredientCatalogState_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
