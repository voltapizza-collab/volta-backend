ALTER TABLE `MenuPizza`
  ADD COLUMN `availableUntil` DATETIME(3) NULL,
  ADD COLUMN `productTags` JSON NULL;
