ALTER TABLE `IngredientLocalSemanticMapping`
  ADD COLUMN `suggestedGlobalIngredientId` INTEGER NULL,
  ADD COLUMN `suggestionScore` INTEGER NULL,
  ADD COLUMN `suggestionConfidence` VARCHAR(191) NULL,
  ADD COLUMN `suggestionReasons` JSON NULL,
  ADD COLUMN `acceptedAt` DATETIME(3) NULL,
  ADD COLUMN `acceptedBy` VARCHAR(191) NULL;

CREATE INDEX `IngredientLocalSemanticMapping_suggestedGlobalIngredientId_idx`
  ON `IngredientLocalSemanticMapping`(`suggestedGlobalIngredientId`);

ALTER TABLE `IngredientLocalSemanticMapping`
  ADD CONSTRAINT `IngredientLocalSemanticMapping_suggestedGlobalIngredientId_fkey`
  FOREIGN KEY (`suggestedGlobalIngredientId`) REFERENCES `Ingredient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
