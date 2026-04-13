ALTER TABLE `Partner`
  ADD COLUMN `deliveryRadiusKm` DOUBLE NULL,
  ADD COLUMN `deliveryPricingMode` ENUM('FIXED', 'VARIABLE') NOT NULL DEFAULT 'FIXED',
  ADD COLUMN `deliveryFeeBlockSize` INT NULL DEFAULT 5,
  ADD COLUMN `deliveryFeeFixed` DOUBLE NULL,
  ADD COLUMN `deliveryFeeBase` DOUBLE NULL,
  ADD COLUMN `deliveryBaseKm` DOUBLE NULL,
  ADD COLUMN `deliveryExtraPerKm` DOUBLE NULL;
