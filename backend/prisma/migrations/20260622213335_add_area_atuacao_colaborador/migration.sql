-- AlterTable
ALTER TABLE `colaboradores` ADD COLUMN `area_atuacao_id` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `colaboradores` ADD CONSTRAINT `colaboradores_area_atuacao_id_fkey` FOREIGN KEY (`area_atuacao_id`) REFERENCES `areas_atuacao`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
