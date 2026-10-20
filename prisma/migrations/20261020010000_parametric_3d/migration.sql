-- AlterTable
ALTER TABLE `Building` ADD COLUMN `floorCount` INTEGER NULL,
    ADD COLUMN `floorHeight` DECIMAL(5, 2) NULL,
    ADD COLUMN `model3d` JSON NULL,
    ADD COLUMN `unitsPerFloor` INTEGER NULL;

-- AlterTable
ALTER TABLE `Amenity` ADD COLUMN `marker` INTEGER NULL,
    ADD COLUMN `position` JSON NULL;

