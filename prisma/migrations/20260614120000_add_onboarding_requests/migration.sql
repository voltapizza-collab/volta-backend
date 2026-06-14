CREATE TABLE `OnboardingRequest` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `businessName` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(64) NULL,
  `message` TEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  `emailStatus` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  `emailSentAt` DATETIME(3) NULL,
  `emailError` TEXT NULL,
  `formalData` JSON NULL,
  `submittedAt` DATETIME(3) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewerNote` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `OnboardingRequest_token_key`(`token`),
  INDEX `OnboardingRequest_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `OnboardingRequest_email_idx`(`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
