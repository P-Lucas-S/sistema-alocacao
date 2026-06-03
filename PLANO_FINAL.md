# Plano Final de Implementação — Sistema de Alocação de Equipes

> Consolidação de quatro fontes: análise técnica do código original, três revisões críticas independentes, e decisões da stakeholder. Base dos prompts de implementação. Cada fase é implementada, testada e aprovada antes da próxima.

---

## Parte 1 — Decisões travadas (não reabrir)

### Integridade e concorrência
1. **Horas nunca em Float.** Usar `Decimal(6,2)` para todos os campos de horas. Comparações de teto e somatórios não toleram erro de ponto flutuante.
2. **Teto protegido por lock pessimista.** Toda criação/alteração de alocação roda dentro de uma transação interativa do Prisma que adquire lock por `(colaboradorId, ano, mes)` — via advisory lock do MySQL (`GET_LOCK`) ou `SELECT ... FOR UPDATE` numa linha-âncora. Recalcula o somatório dentro da transação e só então grava. Verificação na aplicação sem lock está proibida.
3. **Teto FIXO de 220h para todos os colaboradores.** É uma constante global do sistema, não um valor por pessoa. (A tabela de exceções `CapacidadeColaborador` ainda existe para overrides pontuais de férias/licença/afastamento, sobrescrevendo o 220 só naquele colaborador/mês quando houver registro.)

### Cadastro e governança
4. **Gestor cadastra colaborador livremente.** Não há cadastro centralizado nem perfil especial. Qualquer gestor pode criar.
5. **Chave única do colaborador é o e-mail institucional.** `email` é unique + not null — é a trava dura contra duplicata. `nome` é campo de exibição; ao cadastrar, o sistema faz busca de similaridade no nome para AVISAR ("já existe alguém parecido: Fulano"), mas só o e-mail bloqueia de fato. Isso evita que "João Silva" e "Joao Silva" (mesmo nome, pessoas diferentes) se bloqueiem indevidamente, e impede a mesma pessoa virar dois registros.

### Granularidade
6. **Macro e Micro obrigatórias estruturalmente, com atrito zero.** Cada Macro nasce com uma MicroEntrega "Geral" automática. O gestor pode alocar imediatamente sem cadastrar micros, mas a FK permanece NOT NULL e a constraint UNIQUE permanece íntegra (evita a armadilha de NULLs distintos no MySQL). Granularidade fina é opcional de uso, obrigatória de estrutura.

### Edição
7. **Planejado pode ser reduzido depois do mês começar, mas toda alteração vai para o log.** Sem trava de edição; a rastreabilidade vem do log de auditoria.

### Remanejamento
8. **Modelo broadcast.** O gestor interessado sinaliza interesse num colaborador lotado e solicita horas; a solicitação especifica o destino (projeto + macro + micro). A pendência aparece para TODOS os gestores que têm esse colaborador. Cada cedente pode ceder uma PARCELA; a cessão especifica a alocação concreta de origem.
9. **Cessão nunca ultrapassa o pedido.** Dentro da transação: se a soma das cessões já feitas + a nova exceder o solicitado, ajusta para o saldo restante e avisa o cedente. Ao atingir o pedido, a solicitação fecha atomicamente (`atendida`).
10. **Cancelamento não reverte o passado.** Só se pode cancelar enquanto `horasJaCedidas == 0`. Havendo qualquer cessão, o estado final é `atendida` (mesmo parcial).
11. **Prioridade por data de prestação de contas é só VISUAL** (ordena a fila). Não dá direito automático às horas.

### Auditoria e tempo
12. **Toda alocação carrega `createdById` e `updatedById` (FK User).** Log de alterações para o requisito de rastreabilidade do planejado editável.
13. **Meses fecham.** Após a data de prestação de contas do projeto (ou fechamento explícito), as alocações daquele período ficam read-only.

### Papéis e legado
14. **Dois perfis com login: `gestor` e `coordenacao`.** Coordenação é SOMENTE LEITURA em todo o sistema (relatórios, capacidade global). Não aprova, não arbitra, não cede. `admin` permanece para administração técnica.
15. **Colaborador NÃO é usuário.** Não loga. É uma entidade de dados, criada/editada por gestores.
16. **Tabelas do domínio antigo são removidas, não deixadas órfãs.** `Task`, `TaskStep`, `TaskTag`, `TaskHistory`, `TimeEntry`, `Comment` saem via migration de DROP, depois de garantir que nenhum código novo as referencia.

---

## Parte 2 — Riscos conhecidos e aceitos (decisões de negócio, não bugs)

- **Coordenação só observa.** Se os gestores se recusarem a ceder, o broadcast pode travar — risco organizacional assumido conscientemente. O sistema aposta em transparência, não arbitragem.
- **Prioridade por prazo é só visual.** Pode frustrar quem espera que o urgente "ganhe". Mitigação futura opcional: campo de criticidade.
- **Realizado é manual e pode não ser preenchido.** O valor garantido está no planejamento e no teto. O realizado entra como opcional, em fase posterior — o sistema é útil mesmo se nunca for tocado.

---

## Parte 3 — Modelo de dados (resumo)

- **Todas as horas → `Decimal(6,2)`.** Teto = constante 220 no código.
- **`Colaborador`** (entidade nova, NÃO é User): `id`, `nome` (exibição), `email` (unique, not null — chave anti-duplicata), `ativo`, campos de auditoria. Criado por qualquer gestor.
- **`Projeto`**: `id`, `codigo` (unique), `nome`, `gestorId` (FK User, obrigatório, único por projeto — relação 1:N gestor→projetos), `dataPrestacaoContas` (obrigatória), `status`/`arquivado`, `clienteId?` (FK Brand opcional), datas.
- **`MacroEntrega`**: FK projeto obrigatória. Cria Micro "Geral" automática.
- **`MicroEntrega`**: FK macro obrigatória.
- **`Alocacao`**: `colaboradorId`, `projetoId`, `macroEntregaId`, `microEntregaId` (todas FK NOT NULL), `ano`, `mes`, `horasPlanejadas` (Decimal), `horasRealizadas` (Decimal, default 0, opcional de preenchimento), `createdById`, `updatedById`, `status`. UNIQUE(colaboradorId, projetoId, macroEntregaId, microEntregaId, ano, mes). INDEX(colaboradorId, ano, mes).
- **`CapacidadeColaborador`**: só exceções ao teto de 220 (férias/licença). `colaboradorId`, `ano`, `mes`, `horasMaximas`, `tipo`, `motivo` (obrigatório). UNIQUE(colaboradorId, ano, mes).
- **`SolicitacaoRemanejamento`**: `solicitanteId`, `colaboradorId`, `projetoDestinoId`, `macroDestinoId`, `microDestinoId`, `ano`, `mes`, `horasSolicitadas`, `status`, `prazoExpiracao?`, `canceladoPor?`, `canceladoEm?`. `horasJaCedidas` derivado de SUM(cessoes).
- **`CessaoRemanejamento`**: `solicitacaoId`, `gestorCedenteId`, `alocacaoOrigemId` (concreta), `horasCedidas`. Valida saldo da origem na transação; idempotente.
- **`AlocacaoLog`** (fase posterior): log imutável de alterações.
- **`FechamentoMensal`** (ou flag por alocação): torna meses passados read-only.

---

## Parte 4 — Plano de implementação faseado

### Fase 0 — Fundação técnica e limpeza
- Branch git novo.
- Migration de DROP das tabelas legadas.
- `requireRole(...roles)` genérico substituindo checks inline e `requireAdmin()`.
- Roles formais: `admin`, `gestor`, `coordenacao`. Plano de migração dos roles antigos (user/solicitante/coordenador).
- Seed: 1 admin, 1 coordenacao, 3 gestores. (Colaboradores entram na Fase 1, são entidade própria.)
- **Aceite:** roles logam; tabelas antigas removidas; `requireRole` em uso; seed roda; `npm run dev` sobe sem erro fatal.

### Fase 1 — Cadastros e hierarquia (MVP)
- Entidade e CRUD de `Colaborador` (qualquer gestor cadastra; e-mail unique; aviso de similaridade de nome).
- CRUD de `Projeto` (gestor dono; código único; data de prestação de contas).
- CRUD de Macro (com Micro "Geral" automática) e Micro.
- **Aceite:** gestor cria projeto e árvore; colaborador com e-mail repetido é barrado com aviso; coordenação não cria nada (só lê).

### Fase 2 — Alocação mensal com teto (NÚCLEO do MVP)
- Tela de alocação: gestor escolhe projeto/mês, aloca colaborador em micro, lança horas planejadas.
- **Teto FIXO de 220h com lock transacional.**
- **Tela de bloqueio com transparência:** ao bater 220h, mostra "Colaborador X está em 220h: 100h no projeto A (gestor Fulano), 120h no projeto B (gestor Beltrano)".
- Feedback visual verde/amarelo/vermelho.
- **Aceite:** dois gestores tentando estourar o teto simultaneamente — só um passa, o outro vê o bloqueio com a distribuição.

### Fase 3 — Realizado e comparação
- Campo de horas realizadas (lançado pelo gestor, opcional).
- UX de "copiar planejado → realizado".
- Comparação planejado vs realizado por colaborador/projeto/mês.
- Fechamento mensal (read-only após prazo) + log de alterações do planejado.
- **Aceite:** comparação visível; mês fechado não edita; alteração registra quem/quando.

### Fase 4 — Remanejamento broadcast
- Solicitação com destino (projeto+macro+micro); fila ordenada por data de prestação de contas.
- Lista de pendências para cedentes, filtrável por colaborador/projeto.
- Cessão parcial atômica com lock, sem ultrapassar o pedido, fechando ao atingir.
- Cancelamento só sem cessões.
- **Aceite:** três gestores cedendo simultâneo não estouram o pedido; horas movem atomicamente; cedente que tenta ceder horas já movidas falha graciosamente.

### Fase 5 — Coordenação, relatórios e escala
- Visão de capacidade global (agregada por padrão, drill-down sob demanda, filtros obrigatórios, virtualização — escala de 200+ colaboradores).
- Relatórios planejado vs realizado, ociosidade e sobrecarga.
- Exportação CSV. Cópia de planejamento mês a mês.
- **Aceite:** coordenação abre a visão global sem travar; exporta; vê ocioso e no-limite.

### MVP mínimo defensável = Fases 0 + 1 + 2

---

## Parte 5 — Escala (dimensionamento)
~20 gestores, 200+ colaboradores, 200+ projetos simultâneos. A concorrência no teto é cenário cotidiano (não hipotético) — por isso o lock é obrigatório. As telas de listagem global exigem paginação/virtualização/filtros desde o início.

---

## Parte 6 — Identidade visual
Trocar a identidade do sistema original ("registro de ponto") por algo neutro de gestão de alocação. Tarefa transversal, feita junto da Fase 1 e refinada na Fase 5. Não bloqueia nada.
