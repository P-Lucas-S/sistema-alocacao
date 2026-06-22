-- CreateTable
CREATE TABLE `redelegacoes` (
    `id` VARCHAR(191) NOT NULL,
    `projeto_id` VARCHAR(191) NOT NULL,
    `gestor_anterior_id` VARCHAR(191) NOT NULL,
    `gestor_novo_id` VARCHAR(191) NOT NULL,
    `redelegado_por_id` VARCHAR(191) NOT NULL,
    `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `redelegacoes_projeto_id_idx`(`projeto_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `redelegacoes` ADD CONSTRAINT `redelegacoes_redelegado_por_id_fkey` FOREIGN KEY (`redelegado_por_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
