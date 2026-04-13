ALTER TABLE `Partner`
  ADD COLUMN `deliveryMaxPizzasPerOrder` INT NULL,
  ADD COLUMN `brandPrimary` VARCHAR(191) NULL,
  ADD COLUMN `brandSecondary` VARCHAR(191) NULL,
  ADD COLUMN `brandAccent` VARCHAR(191) NULL,
  ADD COLUMN `brandSurface` VARCHAR(191) NULL,
  ADD COLUMN `brandLogoUrl` TEXT NULL,
  ADD COLUMN `brandLogoPublicId` VARCHAR(191) NULL;
