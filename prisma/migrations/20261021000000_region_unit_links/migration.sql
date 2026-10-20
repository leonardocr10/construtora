-- AlterTable
ALTER TABLE `InteractiveRegion` MODIFY `kind` ENUM('BUILDING', 'AMENITY', 'ENTRANCE', 'PARKING', 'POI', 'LOT', 'UNIT') NOT NULL;

-- AlterTable
ALTER TABLE `RegionLink` ADD COLUMN `unitId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `InteractiveMap_developmentId_assetId_idx` ON `InteractiveMap`(`developmentId`, `assetId`);

-- CreateIndex
CREATE INDEX `RegionLink_unitId_idx` ON `RegionLink`(`unitId`);

-- CreateIndex
CREATE UNIQUE INDEX `RegionLink_regionId_unitId_key` ON `RegionLink`(`regionId`, `unitId`);

-- AddForeignKey
ALTER TABLE `RegionLink` ADD CONSTRAINT `RegionLink_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `Unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

