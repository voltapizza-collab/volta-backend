CREATE TABLE `Promo` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `partnerId` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `items` JSON NOT NULL,
  `totalPrice` DOUBLE NOT NULL DEFAULT 0,
  `activeFrom` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NULL,
  `image` VARCHAR(191) NULL,
  `imagePublicId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `Promo_partnerId_status_idx`(`partnerId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Promo`
  ADD CONSTRAINT `Promo_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
