CREATE TABLE `ProductReviewRequest` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `token` VARCHAR(191) NOT NULL,
  `saleId` INTEGER NOT NULL,
  `partnerId` INTEGER NOT NULL,
  `storeId` INTEGER NOT NULL,
  `customerId` INTEGER NULL,
  `customerPhone` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  `sendAfter` DATETIME(3) NOT NULL,
  `sentAt` DATETIME(3) NULL,
  `respondedAt` DATETIME(3) NULL,
  `messageStatus` VARCHAR(64) NULL,
  `messageMeta` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ProductReviewRequest_token_key`(`token`),
  UNIQUE INDEX `ProductReviewRequest_saleId_key`(`saleId`),
  INDEX `ProductReviewRequest_partnerId_status_sendAfter_idx`(`partnerId`, `status`, `sendAfter`),
  INDEX `ProductReviewRequest_storeId_idx`(`storeId`),
  INDEX `ProductReviewRequest_customerId_idx`(`customerId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductReviewVote` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `requestId` INTEGER NOT NULL,
  `saleId` INTEGER NOT NULL,
  `partnerId` INTEGER NOT NULL,
  `storeId` INTEGER NOT NULL,
  `customerId` INTEGER NULL,
  `productId` INTEGER NULL,
  `lineKey` VARCHAR(191) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `vote` VARCHAR(16) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ProductReviewVote_requestId_lineKey_key`(`requestId`, `lineKey`),
  INDEX `ProductReviewVote_partnerId_productId_vote_idx`(`partnerId`, `productId`, `vote`),
  INDEX `ProductReviewVote_storeId_productId_vote_idx`(`storeId`, `productId`, `vote`),
  INDEX `ProductReviewVote_saleId_idx`(`saleId`),
  INDEX `ProductReviewVote_customerId_idx`(`customerId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductReviewRequest`
  ADD CONSTRAINT `ProductReviewRequest_saleId_fkey`
  FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductReviewRequest`
  ADD CONSTRAINT `ProductReviewRequest_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductReviewRequest`
  ADD CONSTRAINT `ProductReviewRequest_storeId_fkey`
  FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductReviewRequest`
  ADD CONSTRAINT `ProductReviewRequest_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductReviewVote`
  ADD CONSTRAINT `ProductReviewVote_requestId_fkey`
  FOREIGN KEY (`requestId`) REFERENCES `ProductReviewRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductReviewVote`
  ADD CONSTRAINT `ProductReviewVote_saleId_fkey`
  FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductReviewVote`
  ADD CONSTRAINT `ProductReviewVote_partnerId_fkey`
  FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductReviewVote`
  ADD CONSTRAINT `ProductReviewVote_storeId_fkey`
  FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductReviewVote`
  ADD CONSTRAINT `ProductReviewVote_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
