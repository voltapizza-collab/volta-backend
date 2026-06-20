CREATE TABLE `IngredientLocalSemanticMapping` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `localIngredientId` INTEGER NOT NULL,
  `globalIngredientId` INTEGER NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'MAPPED',
  `notes` TEXT NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `IngredientLocalSemanticMapping_localIngredientId_key`(`localIngredientId`),
  INDEX `IngredientLocalSemanticMapping_globalIngredientId_idx`(`globalIngredientId`),
  INDEX `IngredientLocalSemanticMapping_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IngredientLocalSemanticMapping`
  ADD CONSTRAINT `IngredientLocalSemanticMapping_localIngredientId_fkey`
  FOREIGN KEY (`localIngredientId`) REFERENCES `Ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IngredientLocalSemanticMapping`
  ADD CONSTRAINT `IngredientLocalSemanticMapping_globalIngredientId_fkey`
  FOREIGN KEY (`globalIngredientId`) REFERENCES `Ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
