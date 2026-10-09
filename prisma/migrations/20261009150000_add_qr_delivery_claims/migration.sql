ALTER TABLE `Customer` ADD COLUMN `marketingSuppressed` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Coupon`
  ADD COLUMN `sourceQrId` INTEGER NULL,
  ADD COLUMN `claimPhone` VARCHAR(20) NULL,
  ADD COLUMN `qrViewCount` INTEGER NOT NULL DEFAULT 0,
  ADD UNIQUE INDEX `Coupon_sourceQrId_claimPhone_key` (`sourceQrId`, `claimPhone`),
  ADD CONSTRAINT `Coupon_sourceQrId_fkey` FOREIGN KEY (`sourceQrId`) REFERENCES `Coupon` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE `CouponClaimThrottle` (
  `key` VARCHAR(64) NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 1,
  `expiresAt` DATETIME(3) NOT NULL,
  INDEX `CouponClaimThrottle_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
