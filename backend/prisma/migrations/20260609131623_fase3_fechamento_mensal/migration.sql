-- CreateTable
CREATE TABLE `fechamentos_mensais` (
    `id` VARCHAR(191) NOT NULL,
    `ano` INTEGER NOT NULL,
    `mes` INTEGER NOT NULL,
    `fechado_por_id` VARCHAR(191) NOT NULL,
    `fechado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `fechamentos_mensais_ano_mes_key`(`ano`, `mes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fechamentos_mensais` ADD CONSTRAINT `fechamentos_mensais_fechado_por_id_fkey` FOREIGN KEY (`fechado_por_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
