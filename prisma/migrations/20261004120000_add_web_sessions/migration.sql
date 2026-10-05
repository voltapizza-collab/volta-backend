CREATE TABLE IF NOT EXISTS `WebSession` (
  `tokenHash` CHAR(64) NOT NULL PRIMARY KEY,
  `role` VARCHAR(24) NOT NULL,
  `partnerId` INT NULL,
  `storeId` INT NULL,
  `credentialHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `WebSession_partner` (`partnerId`),
  INDEX `WebSession_expiry` (`expiresAt`)
);
