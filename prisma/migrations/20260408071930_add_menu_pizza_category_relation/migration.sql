-- AlterTable
ALTER TABLE `MenuPizza` ADD COLUMN `categoryId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `MenuPizza_categoryId_idx` ON `MenuPizza`(`categoryId`);

-- AddForeignKey
ALTER TABLE `MenuPizza` ADD CONSTRAINT `MenuPizza_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
