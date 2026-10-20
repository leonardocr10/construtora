-- CreateTable
CREATE TABLE `ViewerConfiguration` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `activeModelVersionId` VARCHAR(191) NULL,
    `camera` JSON NULL,
    `lighting` JSON NULL,
    `interaction` JSON NULL,
    `publicLayout` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ViewerConfiguration_developmentId_key`(`developmentId`),
    INDEX `ViewerConfiguration_activeModelVersionId_idx`(`activeModelVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiProviderConfiguration` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `provider` ENUM('OPENAI', 'GEMINI', 'MESHY', 'TRIPO', 'PARAMETRIC') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `encryptedApiKey` TEXT NULL,
    `settings` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AiProviderConfiguration_organizationId_provider_key`(`organizationId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ThreeDGeneration` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `generationJobId` VARCHAR(191) NOT NULL,
    `modelVersionId` VARCHAR(191) NULL,
    `mode` ENUM('AI_IMAGES', 'PARAMETRIC', 'IMPORTED') NOT NULL,
    `provider` ENUM('OPENAI', 'GEMINI', 'MESHY', 'TRIPO', 'PARAMETRIC') NULL,
    `providerModel` VARCHAR(191) NULL,
    `externalJobId` VARCHAR(191) NULL,
    `requestedConfiguration` JSON NULL,
    `technicalMetadata` JSON NULL,
    `estimatedCredits` DECIMAL(12, 4) NULL,
    `consumedCredits` DECIMAL(12, 4) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ThreeDGeneration_generationJobId_key`(`generationJobId`),
    UNIQUE INDEX `ThreeDGeneration_modelVersionId_key`(`modelVersionId`),
    UNIQUE INDEX `ThreeDGeneration_externalJobId_key`(`externalJobId`),
    INDEX `ThreeDGeneration_developmentId_createdAt_idx`(`developmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelGenerationInput` (
    `id` VARCHAR(191) NOT NULL,
    `generationId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `view` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `ModelGenerationInput_assetId_idx`(`assetId`),
    UNIQUE INDEX `ModelGenerationInput_generationId_assetId_key`(`generationId`, `assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelReview` (
    `id` VARCHAR(191) NOT NULL,
    `modelVersionId` VARCHAR(191) NOT NULL,
    `reviewerId` VARCHAR(191) NOT NULL,
    `decision` ENUM('APPROVED', 'REJECTED', 'CHANGES_REQUESTED') NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ModelReview_modelVersionId_createdAt_idx`(`modelVersionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CreditLedger` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `provider` ENUM('OPENAI', 'GEMINI', 'MESHY', 'TRIPO', 'PARAMETRIC') NULL,
    `event` ENUM('GRANTED', 'CONSUMED', 'ADJUSTED', 'REFUNDED') NOT NULL,
    `amount` DECIMAL(12, 4) NOT NULL,
    `balanceAfter` DECIMAL(12, 4) NULL,
    `referenceId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CreditLedger_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CreditLedger_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AmenityMedia` ADD CONSTRAINT `AmenityMedia_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `DevelopmentAsset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InteractiveMap` ADD CONSTRAINT `InteractiveMap_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `DevelopmentAsset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegionLink` ADD CONSTRAINT `RegionLink_buildingId_fkey` FOREIGN KEY (`buildingId`) REFERENCES `Building`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegionLink` ADD CONSTRAINT `RegionLink_amenityId_fkey` FOREIGN KEY (`amenityId`) REFERENCES `Amenity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelVersion` ADD CONSTRAINT `ModelVersion_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `DevelopmentAsset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiExtraction` ADD CONSTRAINT `AiExtraction_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `DevelopmentAsset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExtractionReview` ADD CONSTRAINT `ExtractionReview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesStatusHistory` ADD CONSTRAINT `SalesStatusHistory_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ViewerConfiguration` ADD CONSTRAINT `ViewerConfiguration_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiProviderConfiguration` ADD CONSTRAINT `AiProviderConfiguration_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ThreeDGeneration` ADD CONSTRAINT `ThreeDGeneration_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ThreeDGeneration` ADD CONSTRAINT `ThreeDGeneration_generationJobId_fkey` FOREIGN KEY (`generationJobId`) REFERENCES `GenerationJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ThreeDGeneration` ADD CONSTRAINT `ThreeDGeneration_modelVersionId_fkey` FOREIGN KEY (`modelVersionId`) REFERENCES `ModelVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelGenerationInput` ADD CONSTRAINT `ModelGenerationInput_generationId_fkey` FOREIGN KEY (`generationId`) REFERENCES `ThreeDGeneration`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelGenerationInput` ADD CONSTRAINT `ModelGenerationInput_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `DevelopmentAsset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelReview` ADD CONSTRAINT `ModelReview_modelVersionId_fkey` FOREIGN KEY (`modelVersionId`) REFERENCES `ModelVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelReview` ADD CONSTRAINT `ModelReview_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditLedger` ADD CONSTRAINT `CreditLedger_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
