ALTER TABLE `Customer`
    ADD COLUMN `zipCode` VARCHAR(191) NULL,
    ADD COLUMN `activity` ENUM('HOT', 'COLD') NOT NULL DEFAULT 'HOT';

UPDATE `Customer`
SET
    `zipCode` = REGEXP_SUBSTR(`address_1`, '32[0-9]{3}'),
    `activity` = CASE
        WHEN COALESCE(`daysOff`, 0) > 15 THEN 'COLD'
        ELSE 'HOT'
    END;
