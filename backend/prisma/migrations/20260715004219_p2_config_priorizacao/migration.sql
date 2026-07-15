-- CreateTable
CREATE TABLE `configuracao_priorizacao` (
    `id` VARCHAR(191) NOT NULL,
    `prazo_alta_dias` INTEGER NOT NULL DEFAULT 7,
    `prazo_media_dias` INTEGER NOT NULL DEFAULT 30,
    `teto_capacidade_sinal_pct` INTEGER NOT NULL DEFAULT 95,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by_id` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `configuracao_priorizacao` ADD CONSTRAINT `configuracao_priorizacao_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
