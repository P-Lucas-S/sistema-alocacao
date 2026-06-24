-- AlterTable
ALTER TABLE `colaboradores` DROP COLUMN `funcao`,
    ADD COLUMN `profissao_id` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `colaboradores` ADD CONSTRAINT `colaboradores_profissao_id_fkey` FOREIGN KEY (`profissao_id`) REFERENCES `profissoes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
