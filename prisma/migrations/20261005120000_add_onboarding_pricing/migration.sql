CREATE TABLE `OnboardingPricing` (
  `id` INTEGER NOT NULL,
  `posTotalCents` INTEGER NOT NULL DEFAULT 25000,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `updatedBy` VARCHAR(191) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
