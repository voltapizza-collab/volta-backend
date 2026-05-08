ALTER TABLE `Sale`
  ADD COLUMN `boostActive` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `boostTargetPosition` INT NULL,
  ADD COLUMN `boostOriginalPosition` INT NULL,
  ADD COLUMN `boostQueueCredit` INT NOT NULL DEFAULT 0,
  ADD COLUMN `boostAmount` DECIMAL(10, 2) NULL,
  ADD COLUMN `boostPaidAt` DATETIME(3) NULL,
  ADD COLUMN `boostMeta` JSON NULL;

CREATE INDEX `Sale_storeId_processed_status_boostActive_idx`
  ON `Sale`(`storeId`, `processed`, `status`, `boostActive`);
