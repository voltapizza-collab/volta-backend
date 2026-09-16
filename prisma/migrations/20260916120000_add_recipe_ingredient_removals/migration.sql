-- Existing recipes stay unchanged until the business explicitly permits removal.
ALTER TABLE `MenuPizzaIngredient` ADD COLUMN `removable` BOOLEAN NOT NULL DEFAULT false;
