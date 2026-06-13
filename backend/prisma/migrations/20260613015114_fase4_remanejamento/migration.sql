-- AlterTable
ALTER TABLE `alocacao_logs` ADD COLUMN `cessao_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `solicitacoes_remanejamento` (
    `id` VARCHAR(191) NOT NULL,
    `solicitante_id` VARCHAR(191) NOT NULL,
    `colaborador_id` VARCHAR(191) NOT NULL,
    `projeto_destino_id` VARCHAR(191) NOT NULL,
    `macro_entrega_destino_id` VARCHAR(191) NOT NULL,
    `micro_entrega_destino_id` VARCHAR(191) NOT NULL,
    `ano` INTEGER NOT NULL,
    `mes` INTEGER NOT NULL,
    `horas_solicitadas` DECIMAL(6, 2) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `fechado_em` DATETIME(3) NULL,
    `fechado_por_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `solicitacoes_remanejamento_colaborador_id_ano_mes_status_idx`(`colaborador_id`, `ano`, `mes`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cessoes_remanejamento` (
    `id` VARCHAR(191) NOT NULL,
    `solicitacao_id` VARCHAR(191) NOT NULL,
    `gestor_cedente_id` VARCHAR(191) NOT NULL,
    `horas_cedidas` DECIMAL(6, 2) NOT NULL,
    `idempotencia` VARCHAR(191) NOT NULL,
    `alocacao_origem_id` VARCHAR(191) NOT NULL,
    `origem_projeto_id` VARCHAR(191) NOT NULL,
    `origem_macro_entrega_id` VARCHAR(191) NOT NULL,
    `origem_micro_entrega_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cessoes_remanejamento_idempotencia_key`(`idempotencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `solicitacoes_remanejamento` ADD CONSTRAINT `solicitacoes_remanejamento_solicitante_id_fkey` FOREIGN KEY (`solicitante_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitacoes_remanejamento` ADD CONSTRAINT `solicitacoes_remanejamento_colaborador_id_fkey` FOREIGN KEY (`colaborador_id`) REFERENCES `colaboradores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitacoes_remanejamento` ADD CONSTRAINT `solicitacoes_remanejamento_projeto_destino_id_fkey` FOREIGN KEY (`projeto_destino_id`) REFERENCES `projetos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitacoes_remanejamento` ADD CONSTRAINT `solicitacoes_remanejamento_macro_entrega_destino_id_fkey` FOREIGN KEY (`macro_entrega_destino_id`) REFERENCES `macro_entregas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitacoes_remanejamento` ADD CONSTRAINT `solicitacoes_remanejamento_micro_entrega_destino_id_fkey` FOREIGN KEY (`micro_entrega_destino_id`) REFERENCES `micro_entregas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitacoes_remanejamento` ADD CONSTRAINT `solicitacoes_remanejamento_fechado_por_id_fkey` FOREIGN KEY (`fechado_por_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cessoes_remanejamento` ADD CONSTRAINT `cessoes_remanejamento_solicitacao_id_fkey` FOREIGN KEY (`solicitacao_id`) REFERENCES `solicitacoes_remanejamento`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cessoes_remanejamento` ADD CONSTRAINT `cessoes_remanejamento_gestor_cedente_id_fkey` FOREIGN KEY (`gestor_cedente_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheck (manual — Prisma não gera CHECK constraints)
ALTER TABLE `alocacoes` ADD CONSTRAINT `alocacoes_horas_planejadas_nonneg` CHECK (`horas_planejadas` >= 0);
