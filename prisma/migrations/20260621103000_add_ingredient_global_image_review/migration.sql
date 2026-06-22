ALTER TABLE `Ingredient`
  ADD COLUMN `imageStatus` VARCHAR(191) NOT NULL DEFAULT 'MISSING',
  ADD COLUMN `imageSource` VARCHAR(191) NULL,
  ADD COLUMN `imagePrompt` TEXT NULL,
  ADD COLUMN `imageReviewedAt` DATETIME(3) NULL,
  ADD COLUMN `imageReviewedBy` VARCHAR(191) NULL,
  ADD COLUMN `imageVersion` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `imagePolicyVersion` VARCHAR(191) NULL;

CREATE INDEX `Ingredient_imageStatus_idx` ON `Ingredient`(`imageStatus`);
