CREATE TABLE `DirectDiscount` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `partnerId` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `discountType` ENUM('PERCENT', 'FIXED_AMOUNT') NOT NULL,
  `value` DECIMAL(10, 2) NOT NULL,
  `targetType` ENUM('CATEGORY', 'PRODUCT') NOT NULL,
  `productIds` JSON NULL,
  `categoryIds` JSON NULL,
  `categoryNames` JSON NULL,
  `storeIds` JSON NULL,
  `activeFrom` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NULL,
  `daysActive` JSON NULL,
  `windowStart` INTEGER NULL,
  `windowEnd` INTEGER NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `DirectDiscount_partnerId_status_idx`(`partnerId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DirectDiscount`
  ADD CONSTRAINT `DirectDiscount_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
