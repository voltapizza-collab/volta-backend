CREATE TABLE `PosSoftwareRelease` (
  `sha256` VARCHAR(64) NOT NULL,
  `packageName` VARCHAR(100) NOT NULL,
  `versionCode` INTEGER NOT NULL,
  `versionName` VARCHAR(80) NOT NULL,
  `size` INTEGER NOT NULL,
  `certificateSha256` VARCHAR(64) NOT NULL,
  `artifactKey` VARCHAR(200) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `releaseNotes` TEXT NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `publishedBy` VARCHAR(120) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PosSoftwareRelease_versionCode_key` (`versionCode`),
  UNIQUE INDEX `PosSoftwareRelease_artifactKey_key` (`artifactKey`),
  PRIMARY KEY (`sha256`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PosUpdateAssignment` (
  `deviceId` VARCHAR(36) NOT NULL,
  `releaseSha256` VARCHAR(64) NOT NULL,
  `assignedBy` VARCHAR(120) NOT NULL,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `PosUpdateAssignment_releaseSha256_idx` (`releaseSha256`),
  PRIMARY KEY (`deviceId`),
  CONSTRAINT `PosUpdateAssignment_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `PosDevice` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PosUpdateAssignment_releaseSha256_fkey` FOREIGN KEY (`releaseSha256`) REFERENCES `PosSoftwareRelease` (`sha256`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PosSoftwareStatus` (
  `deviceId` VARCHAR(36) NOT NULL,
  `versionCode` INTEGER NULL,
  `targetVersionCode` INTEGER NULL,
  `state` VARCHAR(32) NOT NULL DEFAULT 'unknown',
  `error` VARCHAR(100) NULL,
  `details` JSON NULL,
  `lastCheckAt` DATETIME(3) NULL,
  `lastReportAt` DATETIME(3) NULL,
  PRIMARY KEY (`deviceId`),
  CONSTRAINT `PosSoftwareStatus_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `PosDevice` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
