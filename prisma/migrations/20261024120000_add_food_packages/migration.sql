ALTER TABLE `Partner` ADD COLUMN `foodConfiguration` JSON NULL;
ALTER TABLE `Category` ADD COLUMN `builderType` VARCHAR(24) NOT NULL DEFAULT 'NONE';
UPDATE `Category` SET `builderType` = 'PIZZA' WHERE `customizable` = true;
CREATE TABLE `FoodPackage` (
 `id` INTEGER NOT NULL AUTO_INCREMENT, `name` VARCHAR(120) NOT NULL,
 `description` TEXT NOT NULL, `categoryIds` JSON NOT NULL, `active` BOOLEAN NOT NULL DEFAULT false,
 `position` INTEGER NOT NULL DEFAULT 0, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `FoodConfigurationChange` (
 `id` INTEGER NOT NULL AUTO_INCREMENT, `partnerId` INTEGER NOT NULL, `actor` VARCHAR(191) NOT NULL,
 `before` JSON NULL, `after` JSON NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX `FoodConfigurationChange_partnerId_createdAt_idx` (`partnerId`, `createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Draft templates: a global administrator explicitly maps categories and enables them.
INSERT INTO `FoodPackage` (`name`, `description`, `categoryIds`, `position`, `updatedAt`) VALUES
 ('Pizza', 'Categorías de pizza y sus funciones específicas.', JSON_ARRAY(), 0, CURRENT_TIMESTAMP(3)),
 ('Hamburguesas', 'Categorías de hamburguesas.', JSON_ARRAY(), 1, CURRENT_TIMESTAMP(3)),
 ('Kebab', 'Categorías de kebab.', JSON_ARRAY(), 2, CURRENT_TIMESTAMP(3)),
 ('Pollo', 'Categorías de pollo.', JSON_ARRAY(), 3, CURRENT_TIMESTAMP(3)),
 ('Perritos calientes', 'Categorías de perritos calientes.', JSON_ARRAY(), 4, CURRENT_TIMESTAMP(3)),
 ('Otras comidas', 'Otras categorías del catálogo.', JSON_ARRAY(), 5, CURRENT_TIMESTAMP(3));
