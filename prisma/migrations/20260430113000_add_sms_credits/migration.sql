ALTER TABLE `Partner`
  ADD COLUMN `smsCredits` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `smsRecharged` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `smsConsumed` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `smsLowBalanceThreshold` INTEGER NOT NULL DEFAULT 50;

CREATE TABLE `SmsCreditLedger` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `partnerId` INTEGER NOT NULL,
  `type` ENUM('RECHARGE', 'CONSUME', 'REFUND', 'ADJUSTMENT') NOT NULL,
  `quantity` INTEGER NOT NULL,
  `balanceAfter` INTEGER NOT NULL,
  `amount` DECIMAL(10, 2) NULL,
  `unitPrice` DECIMAL(10, 4) NULL,
  `providerCost` DECIMAL(10, 4) NULL,
  `provider` VARCHAR(64) NULL,
  `reference` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `meta` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `SmsCreditLedger_partnerId_createdAt_idx`(`partnerId`, `createdAt`),
  INDEX `SmsCreditLedger_partnerId_type_idx`(`partnerId`, `type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SmsCreditLedger`
  ADD CONSTRAINT `SmsCreditLedger_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
