-- CreateTable
CREATE TABLE `oficial_mensal_ajustes` (
    `id` VARCHAR(191) NOT NULL,
    `projeto_id` VARCHAR(191) NOT NULL,
    `ano` INTEGER NOT NULL,
    `mes` INTEGER NOT NULL,
    `valor_oficial` DECIMAL(10, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `oficial_mensal_ajustes_projeto_id_idx`(`projeto_id`),
    UNIQUE INDEX `oficial_mensal_ajustes_projeto_id_ano_mes_key`(`projeto_id`, `ano`, `mes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `oficial_mensal_ajustes` ADD CONSTRAINT `oficial_mensal_ajustes_projeto_id_fkey` FOREIGN KEY (`projeto_id`) REFERENCES `projetos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
