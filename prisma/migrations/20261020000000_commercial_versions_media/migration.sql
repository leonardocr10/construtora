-- AlterTable
ALTER TABLE `DevelopmentAsset` ADD COLUMN `buildingId` VARCHAR(191) NULL,
    ADD COLUMN `floorId` VARCHAR(191) NULL,
    ADD COLUMN `floorPlanId` VARCHAR(191) NULL,
    ADD COLUMN `unitId` VARCHAR(191) NULL,
    ADD COLUMN `uploadedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ModelVersion` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD COLUMN `label` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL,
    ADD COLUMN `version` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `GenerationJob` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `createdById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Lead` ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `status` ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'NEGOTIATING', 'WON', 'LOST') NOT NULL DEFAULT 'NEW',
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `Subscription` ADD COLUMN `planId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Plan` (
    `id` VARCHAR(191) NOT NULL,
    `code` ENUM('BASIC', 'PROFESSIONAL', 'ENTERPRISE') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `monthlyPrice` DECIMAL(12, 2) NOT NULL,
    `monthlyCredits` DECIMAL(12, 4) NOT NULL DEFAULT 0,
    `maxDevelopments` INTEGER NOT NULL,
    `maxUsers` INTEGER NOT NULL,
    `maxStorageBytes` BIGINT NOT NULL,
    `features` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Plan_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CreditWallet` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `balance` DECIMAL(12, 4) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CreditWallet_organizationId_key`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Development_coverAssetId_idx` ON `Development`(`coverAssetId`);

-- CreateIndex
CREATE INDEX `DevelopmentAsset_buildingId_idx` ON `DevelopmentAsset`(`buildingId`);

-- CreateIndex
CREATE INDEX `DevelopmentAsset_floorId_idx` ON `DevelopmentAsset`(`floorId`);

-- CreateIndex
CREATE INDEX `DevelopmentAsset_unitId_idx` ON `DevelopmentAsset`(`unitId`);

-- CreateIndex
CREATE INDEX `DevelopmentAsset_floorPlanId_idx` ON `DevelopmentAsset`(`floorPlanId`);

-- CreateIndex
CREATE INDEX `DevelopmentAsset_uploadedById_idx` ON `DevelopmentAsset`(`uploadedById`);

-- CreateIndex
CREATE INDEX `Building_imageAssetId_idx` ON `Building`(`imageAssetId`);

-- CreateIndex
CREATE INDEX `ModelVersion_assetId_idx` ON `ModelVersion`(`assetId`);

-- CreateIndex
CREATE INDEX `ModelVersion_createdById_idx` ON `ModelVersion`(`createdById`);

-- CreateIndex
CREATE UNIQUE INDEX `ModelVersion_developmentId_version_key` ON `ModelVersion`(`developmentId`, `version`);

-- CreateIndex
CREATE INDEX `ModelAnnotation_modelVersionId_idx` ON `ModelAnnotation`(`modelVersionId`);

-- CreateIndex
CREATE INDEX `GenerationJob_status_createdAt_idx` ON `GenerationJob`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `GenerationJob_createdById_idx` ON `GenerationJob`(`createdById`);

-- CreateIndex
CREATE INDEX `Lead_developmentId_status_idx` ON `Lead`(`developmentId`, `status`);

-- CreateIndex
CREATE INDEX `Lead_unitId_idx` ON `Lead`(`unitId`);

-- CreateIndex
CREATE INDEX `Lead_assignedToId_idx` ON `Lead`(`assignedToId`);

-- CreateIndex
CREATE INDEX `Subscription_planId_idx` ON `Subscription`(`planId`);

-- CreateIndex
CREATE INDEX `AuditLog_organizationId_createdAt_idx` ON `AuditLog`(`organizationId`, `createdAt`);

-- CreateIndex
CREATE INDEX `AuditLog_userId_idx` ON `AuditLog`(`userId`);

-- AddForeignKey
ALTER TABLE `Development` ADD CONSTRAINT `Development_coverAssetId_fkey` FOREIGN KEY (`coverAssetId`) REFERENCES `DevelopmentAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevelopmentAsset` ADD CONSTRAINT `DevelopmentAsset_buildingId_fkey` FOREIGN KEY (`buildingId`) REFERENCES `Building`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevelopmentAsset` ADD CONSTRAINT `DevelopmentAsset_floorId_fkey` FOREIGN KEY (`floorId`) REFERENCES `Floor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevelopmentAsset` ADD CONSTRAINT `DevelopmentAsset_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `Unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevelopmentAsset` ADD CONSTRAINT `DevelopmentAsset_floorPlanId_fkey` FOREIGN KEY (`floorPlanId`) REFERENCES `FloorPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevelopmentAsset` ADD CONSTRAINT `DevelopmentAsset_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Building` ADD CONSTRAINT `Building_imageAssetId_fkey` FOREIGN KEY (`imageAssetId`) REFERENCES `DevelopmentAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelVersion` ADD CONSTRAINT `ModelVersion_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GenerationJob` ADD CONSTRAINT `GenerationJob_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ViewerConfiguration` ADD CONSTRAINT `ViewerConfiguration_activeModelVersionId_fkey` FOREIGN KEY (`activeModelVersionId`) REFERENCES `ModelVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditWallet` ADD CONSTRAINT `CreditWallet_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

