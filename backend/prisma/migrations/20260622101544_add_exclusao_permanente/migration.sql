-- AlterTable
ALTER TABLE `projetos` ADD COLUMN `exclusao_solicitada_por_id` VARCHAR(191) NULL,
    ADD COLUMN `motivo_exclusao` TEXT NULL;

-- CreateTable
CREATE TABLE `projeto_excluido` (
    `id` VARCHAR(191) NOT NULL,
    `codigo` VARCHAR(50) NOT NULL,
    `nome` VARCHAR(255) NOT NULL,
    `projeto_id_original` VARCHAR(191) NOT NULL,
    `gestor_id_original` VARCHAR(191) NOT NULL,
    `criado_por_id_original` VARCHAR(191) NOT NULL,
    `solicitante_id` VARCHAR(191) NULL,
    `aprovador_id` VARCHAR(191) NOT NULL,
    `motivo` TEXT NULL,
    `criado_em_original` DATETIME(3) NULL,
    `excluido_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `projeto_excluido_codigo_idx`(`codigo`),
    INDEX `projeto_excluido_projeto_id_original_idx`(`projeto_id_original`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `projetos` ADD CONSTRAINT `projetos_exclusao_solicitada_por_id_fkey` FOREIGN KEY (`exclusao_solicitada_por_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projeto_excluido` ADD CONSTRAINT `projeto_excluido_solicitante_id_fkey` FOREIGN KEY (`solicitante_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projeto_excluido` ADD CONSTRAINT `projeto_excluido_aprovador_id_fkey` FOREIGN KEY (`aprovador_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
