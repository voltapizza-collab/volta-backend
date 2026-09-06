-- CreateTable
CREATE TABLE `PosDevice` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `model` VARCHAR(80) NOT NULL,
    `publicKey` TEXT NOT NULL,
    `publicKeyHash` VARCHAR(64) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'AUTHORIZED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NULL,

    UNIQUE INDEX `PosDevice_publicKeyHash_key`(`publicKeyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PosEnrollment` (
    `id` VARCHAR(36) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `createdBy` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PosEnrollment_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PosSession` (
    `id` VARCHAR(36) NOT NULL,
    `deviceId` VARCHAR(36) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `storeId` INTEGER NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `credentialFingerprint` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PosSession_deviceId_key`(`deviceId`),
    UNIQUE INDEX `PosSession_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PosDeviceNonce` (
    `deviceId` VARCHAR(36) NOT NULL,
    `nonce` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `PosDeviceNonce_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`deviceId`, `nonce`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PosDeviceAudit` (
    `id` VARCHAR(36) NOT NULL,
    `deviceId` VARCHAR(36) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `actor` VARCHAR(120) NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PosDeviceAudit_deviceId_createdAt_idx`(`deviceId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PosLoginThrottle` (
    `key` VARCHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `PosLoginThrottle_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PosSession` ADD CONSTRAINT `PosSession_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `PosDevice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PosSession` ADD CONSTRAINT `PosSession_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PosSession` ADD CONSTRAINT `PosSession_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PosDeviceNonce` ADD CONSTRAINT `PosDeviceNonce_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `PosDevice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PosDeviceAudit` ADD CONSTRAINT `PosDeviceAudit_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `PosDevice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

