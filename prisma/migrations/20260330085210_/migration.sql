/*
  Warnings:

  - You are about to drop the column `country` on the `Store` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Store` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Store` table. All the data in the column will be lost.
  - Added the required column `storeName` to the `Store` table without a default value. This is not possible if the table is not empty.
  - Made the column `address` on table `Store` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `Store` DROP FOREIGN KEY `Store_partnerId_fkey`;

-- AlterTable
ALTER TABLE `Store` DROP COLUMN `country`,
    DROP COLUMN `name`,
    DROP COLUMN `phone`,
    ADD COLUMN `acceptingOrders` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `acceptsReservations` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `latitude` DOUBLE NULL,
    ADD COLUMN `longitude` DOUBLE NULL,
    ADD COLUMN `reservationCapacity` INTEGER NULL,
    ADD COLUMN `storeName` VARCHAR(191) NOT NULL,
    ADD COLUMN `tlf` VARCHAR(191) NULL,
    ADD COLUMN `zipCode` VARCHAR(191) NULL,
    MODIFY `address` VARCHAR(191) NOT NULL;

-- CreateTable
CREATE TABLE `StorePizzaStock` (
    `storeId` INTEGER NOT NULL,
    `pizzaId` INTEGER NOT NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`storeId`, `pizzaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuPizza` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `category` VARCHAR(191) NULL,
    `selectSize` JSON NOT NULL,
    `priceBySize` JSON NOT NULL,
    `cookingMethod` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `imagePublicId` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `type` ENUM('SELLABLE', 'BASE') NOT NULL DEFAULT 'SELLABLE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MenuPizza_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuPizzaIngredient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `menuPizzaId` INTEGER NOT NULL,
    `ingredientId` INTEGER NOT NULL,
    `qtyBySize` JSON NOT NULL,

    INDEX `MenuPizzaIngredient_ingredientId_idx`(`ingredientId`),
    INDEX `MenuPizzaIngredient_menuPizzaId_idx`(`menuPizzaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Incentive` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `triggerMode` ENUM('FIXED', 'SMART_AVG_TICKET') NOT NULL,
    `fixedAmount` DOUBLE NULL,
    `percentOverAvg` DOUBLE NULL,
    `rewardPizzaId` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `daysActive` JSON NULL,
    `windowStart` INTEGER NULL,
    `windowEnd` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ingredient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,
    `unit` VARCHAR(191) NULL,
    `costPrice` DOUBLE NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sale` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `partnerId` INTEGER NOT NULL,
    `storeId` INTEGER NOT NULL,
    `customerId` INTEGER NULL,
    `type` VARCHAR(191) NOT NULL,
    `delivery` ENUM('PICKUP', 'COURIER', 'MARKETPLACE', 'OTHER') NOT NULL,
    `customerData` JSON NULL,
    `products` JSON NOT NULL,
    `extras` JSON NOT NULL,
    `totalProducts` DOUBLE NOT NULL,
    `discounts` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL,
    `processed` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('PENDING', 'AWAITING_PAYMENT', 'PAID', 'CANCELED') NOT NULL DEFAULT 'PENDING',
    `channel` ENUM('WHATSAPP', 'PHONE', 'WEB') NOT NULL DEFAULT 'WHATSAPP',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'EUR',
    `address_1` VARCHAR(191) NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `stripePaymentIntentId` VARCHAR(191) NULL,
    `stripeCheckoutSessionId` VARCHAR(191) NULL,
    `incentiveId` INTEGER NULL,
    `incentiveAmount` DOUBLE NULL DEFAULT 0,

    UNIQUE INDEX `Sale_code_key`(`code`),
    UNIQUE INDEX `Sale_stripePaymentIntentId_key`(`stripePaymentIntentId`),
    UNIQUE INDEX `Sale_stripeCheckoutSessionId_key`(`stripeCheckoutSessionId`),
    INDEX `Sale_date_idx`(`date`),
    INDEX `Sale_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IngredientExtra` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ingredientId` INTEGER NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `price` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IngredientExtra_partnerId_ingredientId_categoryId_key`(`partnerId`, `ingredientId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreIngredientStock` (
    `storeId` INTEGER NOT NULL,
    `ingredientId` INTEGER NOT NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`storeId`, `ingredientId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `name` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address_1` VARCHAR(191) NOT NULL,
    `portal` VARCHAR(191) NULL,
    `observations` VARCHAR(191) NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `origin` ENUM('PHONE', 'WALKIN', 'MARKETPLACE', 'QR', 'OTHER') NOT NULL DEFAULT 'PHONE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `daysOff` INTEGER NULL,
    `isRestricted` BOOLEAN NOT NULL DEFAULT false,
    `restrictedAt` DATETIME(3) NULL,
    `restrictionReason` VARCHAR(191) NULL,
    `segment` ENUM('S1', 'S2', 'S3', 'S4') NOT NULL DEFAULT 'S1',
    `segmentUpdatedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Customer_code_key`(`code`),
    INDEX `Customer_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CouponRedemption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partnerId` INTEGER NOT NULL,
    `couponId` INTEGER NULL,
    `saleId` INTEGER NULL,
    `customerId` INTEGER NULL,
    `storeId` INTEGER NULL,
    `gameId` INTEGER NULL,
    `couponCode` VARCHAR(191) NOT NULL,
    `acquisition` ENUM('GAME', 'CLAIM', 'REWARD', 'BULK', 'DIRECT', 'OTHER') NULL,
    `channel` ENUM('GAME', 'WEB', 'CRM', 'STORE', 'APP', 'SMS', 'EMAIL') NULL,
    `campaign` VARCHAR(191) NULL,
    `segmentAtRedeem` ENUM('S1', 'S2', 'S3', 'S4') NULL,
    `kind` ENUM('PERCENT', 'AMOUNT') NOT NULL,
    `variant` ENUM('FIXED', 'RANGE') NOT NULL,
    `percentApplied` INTEGER NULL,
    `amountApplied` DECIMAL(10, 2) NULL,
    `discountValue` DECIMAL(10, 2) NULL,
    `redeemedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CouponRedemption_partnerId_idx`(`partnerId`),
    INDEX `CouponRedemption_couponCode_idx`(`couponCode`),
    INDEX `CouponRedemption_redeemedAt_idx`(`redeemedAt`),
    INDEX `CouponRedemption_saleId_idx`(`saleId`),
    INDEX `CouponRedemption_customerId_idx`(`customerId`),
    INDEX `CouponRedemption_storeId_idx`(`storeId`),
    INDEX `CouponRedemption_gameId_idx`(`gameId`),
    INDEX `CouponRedemption_channel_idx`(`channel`),
    INDEX `CouponRedemption_acquisition_idx`(`acquisition`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Category_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Coupon` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `kind` ENUM('PERCENT', 'AMOUNT') NOT NULL DEFAULT 'PERCENT',
    `variant` ENUM('FIXED', 'RANGE') NOT NULL DEFAULT 'FIXED',
    `percent` INTEGER NULL,
    `amount` DECIMAL(10, 2) NULL,
    `percentMin` INTEGER NULL,
    `percentMax` INTEGER NULL,
    `maxAmount` DECIMAL(10, 2) NULL,
    `acquisition` ENUM('GAME', 'CLAIM', 'REWARD', 'BULK', 'DIRECT', 'OTHER') NULL,
    `channel` ENUM('GAME', 'WEB', 'CRM', 'STORE', 'APP', 'SMS', 'EMAIL') NULL,
    `gameId` INTEGER NULL,
    `campaign` VARCHAR(191) NULL,
    `meta` JSON NULL,
    `segments` JSON NULL,
    `assignedToId` INTEGER NULL,
    `visibility` ENUM('PUBLIC', 'RESERVED') NOT NULL DEFAULT 'PUBLIC',
    `activeFrom` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `daysActive` JSON NULL,
    `windowStart` INTEGER NULL,
    `windowEnd` INTEGER NULL,
    `usageLimit` INTEGER NOT NULL DEFAULT 1,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('ACTIVE', 'USED', 'EXPIRED', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Coupon_code_key`(`code`),
    INDEX `Coupon_partnerId_idx`(`partnerId`),
    INDEX `Coupon_status_idx`(`status`),
    INDEX `Coupon_assignedToId_idx`(`assignedToId`),
    INDEX `Coupon_expiresAt_idx`(`expiresAt`),
    INDEX `Coupon_acquisition_idx`(`acquisition`),
    INDEX `Coupon_channel_idx`(`channel`),
    INDEX `Coupon_gameId_idx`(`gameId`),
    INDEX `Coupon_acquisition_gameId_idx`(`acquisition`, `gameId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GamePlay` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `gameId` INTEGER NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `playerId` INTEGER NULL,
    `ip` VARCHAR(191) NULL,
    `result` JSON NULL,
    `won` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GamePlay_gameId_createdAt_idx`(`gameId`, `createdAt`),
    INDEX `GamePlay_playerId_createdAt_idx`(`playerId`, `createdAt`),
    INDEX `GamePlay_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Game` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partnerId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `storeId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Game_partnerId_idx`(`partnerId`),
    UNIQUE INDEX `Game_partnerId_slug_key`(`partnerId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreHours` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `storeId` INTEGER NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `openTime` INTEGER NOT NULL,
    `closeTime` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reservation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `storeId` INTEGER NOT NULL,
    `partnerId` INTEGER NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhone` VARCHAR(191) NULL,
    `partySize` INTEGER NOT NULL,
    `reservationDate` DATETIME(3) NOT NULL,
    `reservationTime` VARCHAR(191) NOT NULL,
    `reservationDateTime` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'CANCELED', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Reservation_storeId_reservationDateTime_idx`(`storeId`, `reservationDateTime`),
    INDEX `Reservation_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Store` ADD CONSTRAINT `Store_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StorePizzaStock` ADD CONSTRAINT `StorePizzaStock_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StorePizzaStock` ADD CONSTRAINT `StorePizzaStock_pizzaId_fkey` FOREIGN KEY (`pizzaId`) REFERENCES `MenuPizza`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuPizza` ADD CONSTRAINT `MenuPizza_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuPizzaIngredient` ADD CONSTRAINT `MenuPizzaIngredient_menuPizzaId_fkey` FOREIGN KEY (`menuPizzaId`) REFERENCES `MenuPizza`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuPizzaIngredient` ADD CONSTRAINT `MenuPizzaIngredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incentive` ADD CONSTRAINT `Incentive_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incentive` ADD CONSTRAINT `Incentive_rewardPizzaId_fkey` FOREIGN KEY (`rewardPizzaId`) REFERENCES `MenuPizza`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_incentiveId_fkey` FOREIGN KEY (`incentiveId`) REFERENCES `Incentive`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IngredientExtra` ADD CONSTRAINT `IngredientExtra_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IngredientExtra` ADD CONSTRAINT `IngredientExtra_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IngredientExtra` ADD CONSTRAINT `IngredientExtra_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreIngredientStock` ADD CONSTRAINT `StoreIngredientStock_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreIngredientStock` ADD CONSTRAINT `StoreIngredientStock_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `Ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_couponId_fkey` FOREIGN KEY (`couponId`) REFERENCES `Coupon`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_gameId_fkey` FOREIGN KEY (`gameId`) REFERENCES `Game`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Coupon` ADD CONSTRAINT `Coupon_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Coupon` ADD CONSTRAINT `Coupon_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Coupon` ADD CONSTRAINT `Coupon_gameId_fkey` FOREIGN KEY (`gameId`) REFERENCES `Game`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GamePlay` ADD CONSTRAINT `GamePlay_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GamePlay` ADD CONSTRAINT `GamePlay_gameId_fkey` FOREIGN KEY (`gameId`) REFERENCES `Game`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GamePlay` ADD CONSTRAINT `GamePlay_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreHours` ADD CONSTRAINT `StoreHours_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
