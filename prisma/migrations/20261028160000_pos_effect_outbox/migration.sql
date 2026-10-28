CREATE TABLE `PosEffectOutbox` (
  `id` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `payload` JSON NOT NULL,
  `state` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `error` VARCHAR(100) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `PosEffectOutbox_state_createdAt_idx` (`state`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
