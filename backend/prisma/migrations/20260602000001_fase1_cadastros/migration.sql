-- Fase 1: Cadastros e hierarquia
-- Colaborador (entidade de dados, não é User), Projeto, MacroEntrega, MicroEntrega

-- CreateTable
CREATE TABLE `colaboradores` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `funcao` VARCHAR(100) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `colaboradores_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projetos` (
    `id` VARCHAR(191) NOT NULL,
    `codigo` VARCHAR(50) NOT NULL,
    `nome` VARCHAR(255) NOT NULL,
    `gestor_id` VARCHAR(191) NOT NULL,
    `data_prestacao_contas` DATETIME(3) NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'ativo',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `projetos_codigo_key`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `macro_entregas` (
    `id` VARCHAR(191) NOT NULL,
    `projeto_id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(255) NOT NULL,
    `descricao` TEXT NULL,
    `deadline` DATETIME(3) NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'ativa',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `micro_entregas` (
    `id` VARCHAR(191) NOT NULL,
    `macro_entrega_id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(255) NOT NULL,
    `descricao` TEXT NULL,
    `deadline` DATETIME(3) NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'pendente',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `colaboradores` ADD CONSTRAINT `colaboradores_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projetos` ADD CONSTRAINT `projetos_gestor_id_fkey` FOREIGN KEY (`gestor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `macro_entregas` ADD CONSTRAINT `macro_entregas_projeto_id_fkey` FOREIGN KEY (`projeto_id`) REFERENCES `projetos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `micro_entregas` ADD CONSTRAINT `micro_entregas_macro_entrega_id_fkey` FOREIGN KEY (`macro_entrega_id`) REFERENCES `macro_entregas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
