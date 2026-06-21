-- AlterTable: adiciona a coluna como NULLABLE primeiro, pra poder fazer o
-- backfill nos projetos existentes (criado_por_id ainda não existe pra eles;
-- só vira NOT NULL depois do UPDATE abaixo).
ALTER TABLE `projetos` ADD COLUMN `criado_por_id` VARCHAR(191) NULL;

-- Backfill: o criador original de um projeto já existente era o próprio gestor.
UPDATE `projetos` SET `criado_por_id` = `gestor_id` WHERE `criado_por_id` IS NULL;

-- Agora que toda linha tem valor, a coluna pode virar NOT NULL.
ALTER TABLE `projetos` MODIFY COLUMN `criado_por_id` VARCHAR(191) NOT NULL;

-- AddForeignKey
ALTER TABLE `projetos` ADD CONSTRAINT `projetos_criado_por_id_fkey` FOREIGN KEY (`criado_por_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
