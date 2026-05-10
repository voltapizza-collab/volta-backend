CREATE TABLE `IngredientCategoryUse` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ingredientId` INTEGER NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `price` DOUBLE NULL,
    `priceBySize` JSON NULL,
    `costPrice` DOUBLE NULL,
    `costBySize` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IngredientCategoryUse_partnerId_ingredientId_categoryId_key`(`partnerId`, `ingredientId`, `categoryId`),
    INDEX `IngredientCategoryUse_partnerId_categoryId_active_idx`(`partnerId`, `categoryId`, `active`),
    INDEX `IngredientCategoryUse_ingredientId_idx`(`ingredientId`),
    INDEX `IngredientCategoryUse_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IngredientCategoryUse`
  ADD CONSTRAINT `IngredientCategoryUse_ingredientId_fkey`
  FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IngredientCategoryUse`
  ADD CONSTRAINT `IngredientCategoryUse_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IngredientCategoryUse`
  ADD CONSTRAINT `IngredientCategoryUse_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
