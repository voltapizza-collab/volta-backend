CREATE TABLE `CouponReservation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `couponId` INTEGER NOT NULL,
  `saleId` INTEGER NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
  `stripeSessionId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CouponReservation_saleId_key` (`saleId`),
  INDEX `CouponReservation_couponId_status_idx` (`couponId`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `CouponReservation_couponId_fkey` FOREIGN KEY (`couponId`) REFERENCES `Coupon` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CouponReservation_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve capacity held by checkout sessions opened before this deployment.
INSERT INTO `CouponReservation` (`couponId`, `saleId`, `stripeSessionId`, `createdAt`, `updatedAt`)
SELECT c.id, s.id, s.stripeCheckoutSessionId, s.createdAt, CURRENT_TIMESTAMP(3)
FROM `Sale` s JOIN `Coupon` c ON c.partnerId = s.partnerId
  AND JSON_CONTAINS(s.products, JSON_OBJECT('couponCode', c.code))
WHERE s.status = 'AWAITING_PAYMENT' AND c.usageUnlimited = false;
