CREATE TABLE `BoostSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `unitPrice` DOUBLE NOT NULL DEFAULT 0.2,
    `maxOptions` INTEGER NOT NULL DEFAULT 3,
    `voltaSharePercent` DOUBLE NOT NULL DEFAULT 25,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `BoostSetting` (
  `id`,
  `active`,
  `unitPrice`,
  `maxOptions`,
  `voltaSharePercent`,
  `createdAt`,
  `updatedAt`
)
VALUES (
  1,
  true,
  COALESCE(NULLIF(CAST('0.2' AS DECIMAL(10, 2)), 0), 0.2),
  3,
  25,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
);
