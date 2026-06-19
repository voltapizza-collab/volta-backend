CREATE TABLE `IngredientSemanticCategory` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `canonicalKey` VARCHAR(191) NOT NULL,
  `defaultName` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `position` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `IngredientSemanticCategory_canonicalKey_key`(`canonicalKey`),
  INDEX `IngredientSemanticCategory_status_position_idx`(`status`, `position`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IngredientSemanticCategoryTranslation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `categoryId` INTEGER NOT NULL,
  `locale` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `isReviewed` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `IngredientSemanticCategoryTranslation_categoryId_locale_key`(`categoryId`, `locale`),
  INDEX `IngredientSemanticCategoryTranslation_locale_idx`(`locale`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IngredientTranslation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ingredientId` INTEGER NOT NULL,
  `locale` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `isReviewed` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `IngredientTranslation_ingredientId_locale_key`(`ingredientId`, `locale`),
  INDEX `IngredientTranslation_locale_idx`(`locale`),
  INDEX `IngredientTranslation_name_idx`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IngredientAlias` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ingredientId` INTEGER NOT NULL,
  `locale` VARCHAR(191) NULL,
  `country` VARCHAR(191) NULL,
  `alias` VARCHAR(191) NOT NULL,
  `normalizedAlias` VARCHAR(191) NOT NULL,
  `searchable` BOOLEAN NOT NULL DEFAULT true,
  `displayable` BOOLEAN NOT NULL DEFAULT false,
  `isReviewed` BOOLEAN NOT NULL DEFAULT false,
  `source` VARCHAR(191) NOT NULL DEFAULT 'SYSTEM',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `IngredientAlias_ingredientId_locale_normalizedAlias_key`(`ingredientId`, `locale`, `normalizedAlias`),
  INDEX `IngredientAlias_ingredientId_idx`(`ingredientId`),
  INDEX `IngredientAlias_normalizedAlias_idx`(`normalizedAlias`),
  INDEX `IngredientAlias_locale_idx`(`locale`),
  INDEX `IngredientAlias_country_idx`(`country`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Partner`
  ADD COLUMN `backofficeLocale` VARCHAR(191) NOT NULL DEFAULT 'es';

ALTER TABLE `Ingredient`
  ADD COLUMN `canonicalKey` VARCHAR(191) NULL,
  ADD COLUMN `semanticStatus` VARCHAR(191) NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN `semanticCategoryId` INTEGER NULL;

CREATE UNIQUE INDEX `Ingredient_canonicalKey_key` ON `Ingredient`(`canonicalKey`);
CREATE INDEX `Ingredient_semanticCategoryId_idx` ON `Ingredient`(`semanticCategoryId`);
CREATE INDEX `Ingredient_semanticStatus_idx` ON `Ingredient`(`semanticStatus`);

ALTER TABLE `Ingredient`
  ADD CONSTRAINT `Ingredient_semanticCategoryId_fkey`
  FOREIGN KEY (`semanticCategoryId`) REFERENCES `IngredientSemanticCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IngredientSemanticCategoryTranslation`
  ADD CONSTRAINT `IngredientSemanticCategoryTranslation_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `IngredientSemanticCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IngredientTranslation`
  ADD CONSTRAINT `IngredientTranslation_ingredientId_fkey`
  FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IngredientAlias`
  ADD CONSTRAINT `IngredientAlias_ingredientId_fkey`
  FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
