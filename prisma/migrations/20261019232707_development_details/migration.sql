-- AlterTable
ALTER TABLE `development` ADD COLUMN `code` VARCHAR(191) NULL,
    ADD COLUMN `deliveryDate` DATETIME(3) NULL,
    ADD COLUMN `latitude` DECIMAL(10, 7) NULL,
    ADD COLUMN `longitude` DECIMAL(10, 7) NULL,
    ADD COLUMN `zipCode` VARCHAR(191) NULL;
