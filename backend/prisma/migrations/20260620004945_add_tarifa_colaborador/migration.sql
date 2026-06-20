-- CreateTable
CREATE TABLE `tarifas_colaborador` (
    `id` VARCHAR(191) NOT NULL,
    `colaboradorId` VARCHAR(191) NOT NULL,
    `categoriaId` VARCHAR(191) NOT NULL,
    `valorHora` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tarifas_colaborador_categoriaId_idx`(`categoriaId`),
    UNIQUE INDEX `tarifas_colaborador_colaboradorId_categoriaId_key`(`colaboradorId`, `categoriaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tarifas_colaborador` ADD CONSTRAINT `tarifas_colaborador_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `colaboradores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tarifas_colaborador` ADD CONSTRAINT `tarifas_colaborador_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `categorias_projeto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
