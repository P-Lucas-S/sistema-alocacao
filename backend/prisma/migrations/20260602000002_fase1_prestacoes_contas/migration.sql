-- Fase 1: múltiplas datas de prestação de contas por projeto
-- Tipo DATE puro (sem hora/fuso) + migração dos dados existentes

-- Passo 1: Criar tabela destino antes de qualquer manipulação nos dados
CREATE TABLE `prestacoes_contas` (
    `id` VARCHAR(191) NOT NULL,
    `projeto_id` VARCHAR(191) NOT NULL,
    `data` DATE NOT NULL,

    INDEX `prestacoes_contas_projeto_id_idx`(`projeto_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Passo 2: FK com CASCADE — prestações não existem sem o projeto
ALTER TABLE `prestacoes_contas`
    ADD CONSTRAINT `prestacoes_contas_projeto_id_fkey`
    FOREIGN KEY (`projeto_id`) REFERENCES `projetos`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Passo 3: Migrar dados — copia a data de cada projeto ANTES de dropar a coluna
--          DATE() descarta a componente de hora (era DATETIME, vira DATE puro)
--          CONCAT('mig-', id) gera ID único e rastreável por projeto migrado
INSERT INTO `prestacoes_contas` (`id`, `projeto_id`, `data`)
SELECT CONCAT('mig-', id), id, DATE(`data_prestacao_contas`)
FROM `projetos`
WHERE `data_prestacao_contas` IS NOT NULL;

-- Passo 4: Remover coluna antiga — executado somente após dados copiados
ALTER TABLE `projetos` DROP COLUMN `data_prestacao_contas`;
