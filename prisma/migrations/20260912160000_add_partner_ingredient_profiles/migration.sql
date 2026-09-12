CREATE TABLE IF NOT EXISTS `PartnerIngredientProfile` (
  `partnerId` INTEGER NOT NULL,
  `ingredientId` INTEGER NOT NULL,
  `costPrice` DECIMAL(10,2) NOT NULL,
  `description` TEXT NULL,
  `image` TEXT NULL,
  `imagePublicId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`partnerId`, `ingredientId`),
  INDEX `PartnerIngredientProfile_ingredientId_idx` (`ingredientId`),
  CONSTRAINT `PartnerIngredientProfile_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PartnerIngredientProfile_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
