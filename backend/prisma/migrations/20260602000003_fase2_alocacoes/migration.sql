-- Fase 2: tabela de alocações mensais com teto de 220h
-- Sem migração de dados — não existem alocações ainda.

-- CreateTable
CREATE TABLE `alocacoes` (
    `id` VARCHAR(191) NOT NULL,
    `colaborador_id` VARCHAR(191) NOT NULL,
    `projeto_id` VARCHAR(191) NOT NULL,
    `macro_entrega_id` VARCHAR(191) NOT NULL,
    `micro_entrega_id` VARCHAR(191) NOT NULL,
    `ano` INTEGER NOT NULL,
    `mes` INTEGER NOT NULL,
    `horas_planejadas` DECIMAL(6, 2) NOT NULL,
    `horas_realizadas` DECIMAL(6, 2) NULL,
    `created_by_id` VARCHAR(191) NOT NULL,
    `updated_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `alocacoes_colaborador_id_ano_mes_idx`(`colaborador_id`, `ano`, `mes`),
    UNIQUE INDEX `alocacoes_colaborador_id_projeto_id_macro_entrega_id_micro_e_key`(`colaborador_id`, `projeto_id`, `macro_entrega_id`, `micro_entrega_id`, `ano`, `mes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `alocacoes` ADD CONSTRAINT `alocacoes_colaborador_id_fkey` FOREIGN KEY (`colaborador_id`) REFERENCES `colaboradores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alocacoes` ADD CONSTRAINT `alocacoes_projeto_id_fkey` FOREIGN KEY (`projeto_id`) REFERENCES `projetos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alocacoes` ADD CONSTRAINT `alocacoes_macro_entrega_id_fkey` FOREIGN KEY (`macro_entrega_id`) REFERENCES `macro_entregas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alocacoes` ADD CONSTRAINT `alocacoes_micro_entrega_id_fkey` FOREIGN KEY (`micro_entrega_id`) REFERENCES `micro_entregas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alocacoes` ADD CONSTRAINT `alocacoes_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alocacoes` ADD CONSTRAINT `alocacoes_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
