-- CreateTable
CREATE TABLE `LayoutControlPoint` (
    `id` VARCHAR(191) NOT NULL,
    `developmentId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `pixelX` DECIMAL(10, 2) NOT NULL,
    `pixelY` DECIMAL(10, 2) NOT NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `source` ENUM('OSM', 'SURVEY', 'GPS', 'MANUAL') NOT NULL DEFAULT 'OSM',
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LayoutControlPoint_developmentId_idx`(`developmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LayoutControlPoint` ADD CONSTRAINT `LayoutControlPoint_developmentId_fkey` FOREIGN KEY (`developmentId`) REFERENCES `Development`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
