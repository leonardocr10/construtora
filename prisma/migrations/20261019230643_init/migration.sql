-- CreateTable
CREATE TABLE `Organization` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Organization_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrganizationUser` (
    `organizationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPERADMIN', 'ADMIN', 'MANAGER', 'EDITOR', 'BROKER') NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrganizationUser_userId_active_idx`(`userId`, `active`),
    PRIMARY KEY (`organizationId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Development` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'PREPARING', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `coverAssetId` VARCHAR(191) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Development_slug_key`(`slug`),
    INDEX `Development_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `Development_organizationId_updatedAt_idx`(`organizationId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevelopmentSettings` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `contactPhone` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `whatsapp` VARCHAR(191) NULL,
    `officialSite` VARCHAR(191) NULL,
    `navigation` JSON NULL,

    UNIQUE INDEX `DevelopmentSettings_developmentId_key`(`developmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevelopmentTheme` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `primaryColor` VARCHAR(191) NOT NULL DEFAULT '#2563eb',
    `secondaryColor` VARCHAR(191) NOT NULL DEFAULT '#101d33',
    `fontFamily` VARCHAR(191) NOT NULL DEFAULT 'Inter',
    `logoAssetId` VARCHAR(191) NULL,
    `configuration` JSON NULL,

    UNIQUE INDEX `DevelopmentTheme_developmentId_key`(`developmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevelopmentAsset` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `kind` ENUM('EBOOK', 'IMPLANTATION', 'FACADE', 'FLOOR_PLAN', 'SALES_MIRROR', 'AMENITY', 'INTERIOR_RENDER', 'AERIAL', 'MODEL_3D', 'OTHER') NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `byteSize` BIGINT NOT NULL,
    `checksum` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DevelopmentAsset_storageKey_key`(`storageKey`),
    INDEX `DevelopmentAsset_developmentId_kind_idx`(`developmentId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Building` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `imageAssetId` VARCHAR(191) NULL,
    `position` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Building_developmentId_code_key`(`developmentId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Floor` (
    `id` VARCHAR(191) NOT NULL,
    `buildingId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL,

    UNIQUE INDEX `Floor_buildingId_number_key`(`buildingId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UnitType` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `bedrooms` INTEGER NULL,
    `suites` INTEGER NULL,
    `privateArea` DECIMAL(10, 2) NULL,
    `description` TEXT NULL,

    INDEX `UnitType_developmentId_idx`(`developmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Unit` (
    `id` VARCHAR(191) NOT NULL,
    `buildingId` VARCHAR(191) NOT NULL,
    `floorId` VARCHAR(191) NULL,
    `unitTypeId` VARCHAR(191) NULL,
    `number` VARCHAR(191) NOT NULL,
    `final` VARCHAR(191) NULL,
    `status` ENUM('AVAILABLE', 'RESERVED', 'SOLD', 'BLOCKED', 'UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE',
    `privateArea` DECIMAL(10, 2) NULL,
    `totalArea` DECIMAL(10, 2) NULL,
    `price` DECIMAL(14, 2) NULL,

    INDEX `Unit_buildingId_status_idx`(`buildingId`, `status`),
    INDEX `Unit_floorId_idx`(`floorId`),
    UNIQUE INDEX `Unit_buildingId_number_key`(`buildingId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FloorPlan` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `area` DECIMAL(10, 2) NULL,
    `bedrooms` INTEGER NULL,
    `suites` INTEGER NULL,
    `bathrooms` INTEGER NULL,
    `parkingSpaces` INTEGER NULL,
    `description` TEXT NULL,

    INDEX `FloorPlan_developmentId_idx`(`developmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UnitFloorPlan` (
    `unitId` VARCHAR(191) NOT NULL,
    `floorPlanId` VARCHAR(191) NOT NULL,
    `primary` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`unitId`, `floorPlanId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Amenity` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AmenityMedia` (
    `id` VARCHAR(191) NOT NULL,
    `amenityId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `AmenityMedia_amenityId_idx`(`amenityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InteractiveMap` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InteractiveRegion` (
    `id` VARCHAR(191) NOT NULL,
    `mapId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('BUILDING', 'AMENITY', 'ENTRANCE', 'PARKING', 'POI') NOT NULL,
    `geometry` JSON NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `InteractiveRegion_mapId_idx`(`mapId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegionLink` (
    `id` VARCHAR(191) NOT NULL,
    `regionId` VARCHAR(191) NOT NULL,
    `buildingId` VARCHAR(191) NULL,
    `amenityId` VARCHAR(191) NULL,

    UNIQUE INDEX `RegionLink_regionId_buildingId_key`(`regionId`, `buildingId`),
    UNIQUE INDEX `RegionLink_regionId_amenityId_key`(`regionId`, `amenityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelVersion` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `approvedAt` DATETIME(3) NULL,
    `warnings` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelAnnotation` (
    `id` VARCHAR(191) NOT NULL,
    `modelVersionId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `position` JSON NOT NULL,
    `link` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GenerationJob` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `kind` ENUM('AI_EXTRACTION', 'MODEL_GENERATION', 'IMAGE_OPTIMIZATION') NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `provider` VARCHAR(191) NULL,
    `input` JSON NULL,
    `output` JSON NULL,
    `error` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GenerationJob_developmentId_status_idx`(`developmentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiExtraction` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `source` JSON NULL,
    `confidence` DECIMAL(5, 4) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AiExtraction_developmentId_confirmedAt_idx`(`developmentId`, `confirmedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExtractionReview` (
    `id` VARCHAR(191) NOT NULL,
    `extractionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accepted` BOOLEAN NOT NULL,
    `correctedValue` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesStatusHistory` (
    `id` VARCHAR(191) NOT NULL,
    `unitId` VARCHAR(191) NOT NULL,
    `previousStatus` ENUM('AVAILABLE', 'RESERVED', 'SOLD', 'BLOCKED', 'UNAVAILABLE') NULL,
    `status` ENUM('AVAILABLE', 'RESERVED', 'SOLD', 'BLOCKED', 'UNAVAILABLE') NOT NULL,
    `changedById` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SalesStatusHistory_unitId_createdAt_idx`(`unitId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lead` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `unitId` VARCHAR(191) NULL,
    `assignedToId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `source` VARCHAR(191) NULL,
    `consentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Lead_developmentId_createdAt_idx`(`developmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Publication` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `currentVersionId` VARCHAR(191) NULL,
    `publishedAt` DATETIME(3) NULL,

    INDEX `Publication_developmentId_status_idx`(`developmentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PublicationVersion` (
    `id` VARCHAR(191) NOT NULL,
    `publicationId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PublicationVersion_publicationId_version_key`(`publicationId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ViewEvent` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `sessionHash` VARCHAR(191) NULL,
    `event` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ViewEvent_developmentId_createdAt_idx`(`developmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `plan` ENUM('BASIC', 'PROFESSIONAL', 'ENTERPRISE') NOT NULL,
    `limits` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NULL,

    INDEX `Subscription_organizationId_active_idx`(`organizationId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UsageLedger` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `metric` VARCHAR(191) NOT NULL,
    `quantity` BIGINT NOT NULL,
    `referenceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UsageLedger_organizationId_metric_createdAt_idx`(`organizationId`, `metric`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_organizationId_entityType_entityId_idx`(`organizationId`, `entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrganizationUser` ADD CONSTRAINT `OrganizationUser_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrganizationUser` ADD CONSTRAINT `OrganizationUser_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Development` ADD CONSTRAINT `Development_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevelopmentSettings` ADD CONSTRAINT `DevelopmentSettings_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevelopmentTheme` ADD CONSTRAINT `DevelopmentTheme_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevelopmentAsset` ADD CONSTRAINT `DevelopmentAsset_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Building` ADD CONSTRAINT `Building_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Floor` ADD CONSTRAINT `Floor_buildingId_fkey` FOREIGN KEY (`buildingId`) REFERENCES `Building`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnitType` ADD CONSTRAINT `UnitType_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Unit` ADD CONSTRAINT `Unit_buildingId_fkey` FOREIGN KEY (`buildingId`) REFERENCES `Building`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Unit` ADD CONSTRAINT `Unit_floorId_fkey` FOREIGN KEY (`floorId`) REFERENCES `Floor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Unit` ADD CONSTRAINT `Unit_unitTypeId_fkey` FOREIGN KEY (`unitTypeId`) REFERENCES `UnitType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FloorPlan` ADD CONSTRAINT `FloorPlan_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnitFloorPlan` ADD CONSTRAINT `UnitFloorPlan_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `Unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnitFloorPlan` ADD CONSTRAINT `UnitFloorPlan_floorPlanId_fkey` FOREIGN KEY (`floorPlanId`) REFERENCES `FloorPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Amenity` ADD CONSTRAINT `Amenity_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AmenityMedia` ADD CONSTRAINT `AmenityMedia_amenityId_fkey` FOREIGN KEY (`amenityId`) REFERENCES `Amenity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractiveMap` ADD CONSTRAINT `InteractiveMap_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractiveRegion` ADD CONSTRAINT `InteractiveRegion_mapId_fkey` FOREIGN KEY (`mapId`) REFERENCES `InteractiveMap`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegionLink` ADD CONSTRAINT `RegionLink_regionId_fkey` FOREIGN KEY (`regionId`) REFERENCES `InteractiveRegion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelVersion` ADD CONSTRAINT `ModelVersion_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelAnnotation` ADD CONSTRAINT `ModelAnnotation_modelVersionId_fkey` FOREIGN KEY (`modelVersionId`) REFERENCES `ModelVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GenerationJob` ADD CONSTRAINT `GenerationJob_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiExtraction` ADD CONSTRAINT `AiExtraction_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExtractionReview` ADD CONSTRAINT `ExtractionReview_extractionId_fkey` FOREIGN KEY (`extractionId`) REFERENCES `AiExtraction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesStatusHistory` ADD CONSTRAINT `SalesStatusHistory_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `Unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `Unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Publication` ADD CONSTRAINT `Publication_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublicationVersion` ADD CONSTRAINT `PublicationVersion_publicationId_fkey` FOREIGN KEY (`publicationId`) REFERENCES `Publication`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ViewEvent` ADD CONSTRAINT `ViewEvent_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UsageLedger` ADD CONSTRAINT `UsageLedger_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
