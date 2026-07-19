-- AlterTable
ALTER TABLE `projetos` ADD COLUMN `prioridade_fixada` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `prioridade_pausada` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `prioridade_logs` (
    `id` VARCHAR(191) NOT NULL,
    `projeto_id` VARCHAR(191) NOT NULL,
    `acao` VARCHAR(20) NOT NULL,
    `usuario_id` VARCHAR(191) NOT NULL,
    `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `prioridade_logs_projeto_id_idx`(`projeto_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `prioridade_logs` ADD CONSTRAINT `prioridade_logs_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
