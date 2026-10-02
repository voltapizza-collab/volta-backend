-- Idempotent because older application instances can add settings columns on demand.
SET @logo_sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'Partner' AND column_name = 'brandLogoOriginalUrl') = 0,
  'ALTER TABLE `Partner` ADD COLUMN `brandLogoOriginalUrl` TEXT NULL', 'SELECT 1');
PREPARE logo_stmt FROM @logo_sql;
EXECUTE logo_stmt;
DEALLOCATE PREPARE logo_stmt;

SET @logo_sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'Partner' AND column_name = 'brandLogoOriginalPublicId') = 0,
  'ALTER TABLE `Partner` ADD COLUMN `brandLogoOriginalPublicId` VARCHAR(191) NULL', 'SELECT 1');
PREPARE logo_stmt FROM @logo_sql;
EXECUTE logo_stmt;
DEALLOCATE PREPARE logo_stmt;

SET @logo_sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'Partner' AND column_name = 'brandLogoProcessing') = 0,
  'ALTER TABLE `Partner` ADD COLUMN `brandLogoProcessing` VARCHAR(32) NULL', 'SELECT 1');
PREPARE logo_stmt FROM @logo_sql;
EXECUTE logo_stmt;
DEALLOCATE PREPARE logo_stmt;
