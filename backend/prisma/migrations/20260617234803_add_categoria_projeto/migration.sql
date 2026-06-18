-- AlterTable
ALTER TABLE `projetos` ADD COLUMN `categoriaId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `categorias_projeto` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `categorias_projeto_nome_key`(`nome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `projetos` ADD CONSTRAINT `projetos_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `categorias_projeto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
