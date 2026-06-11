-- CreateTable
CREATE TABLE `alocacao_logs` (
    `id` VARCHAR(191) NOT NULL,
    `alocacao_id` VARCHAR(191) NOT NULL,
    `colaborador_id` VARCHAR(191) NOT NULL,
    `projeto_id` VARCHAR(191) NOT NULL,
    `macro_entrega_id` VARCHAR(191) NOT NULL,
    `micro_entrega_id` VARCHAR(191) NOT NULL,
    `ano` INTEGER NOT NULL,
    `mes` INTEGER NOT NULL,
    `acao` VARCHAR(20) NOT NULL,
    `horas_anteriores` DECIMAL(6, 2) NULL,
    `horas_novas` DECIMAL(6, 2) NULL,
    `usuario_id` VARCHAR(191) NOT NULL,
    `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `alocacao_logs_alocacao_id_idx`(`alocacao_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `alocacao_logs` ADD CONSTRAINT `alocacao_logs_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
