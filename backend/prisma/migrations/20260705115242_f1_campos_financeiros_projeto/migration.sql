-- AlterTable
ALTER TABLE `projetos` ADD COLUMN `estrategia_oficial` VARCHAR(50) NOT NULL DEFAULT 'inicial',
    ADD COLUMN `valor_oficial` DECIMAL(10, 2) NULL,
    ADD COLUMN `valor_total` DECIMAL(10, 2) NULL,
    ADD COLUMN `vigencia_fim` DATE NULL,
    ADD COLUMN `vigencia_inicio` DATE NULL;
