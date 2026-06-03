# Sistema de Alocação de Equipes — Progresso e Decisões

> **Propósito deste documento.** Registro vivo do estado de execução do projeto. O `PLANO_FINAL.md` descreve *o que* construir; este documento registra *o que já foi construído*, *as decisões tomadas durante a implementação* e *como continuar*. Serve de contexto para qualquer pessoa — ou qualquer sessão futura do Claude Code — que pegar o projeto daqui em diante.
>
> **Última atualização:** fim da Fase 2 / C1 (núcleo do teto de 220h).

---

## 1. O que é o sistema

Sistema de **planejamento de alocação de equipes** para uma organização com cerca de 20 gestores, 200+ colaboradores e 200+ projetos. Adaptado de um sistema legado de registro de ponto (que foi quase inteiramente removido).

O objetivo central é **comunicação entre gestores e documentação da equipe**: cada gestor planeja quantas horas cada colaborador dedicará a cada projeto por mês, e o sistema garante que ninguém ultrapasse o teto mensal de horas — mesmo quando vários gestores disputam os mesmos colaboradores.

### Stack
- **Backend:** Node + Express + Prisma + MariaDB (provider `mysql`).
- **Frontend:** React + Vite + Tailwind.
- **Execução local:** `npm run dev` na raiz (usa `concurrently`). Backend em `:3001`, frontend em `:5173`. MariaDB local, banco `registro_horas`, `root`/`123`.

### Perfis de usuário
- **`gestor`** — cadastra colaboradores e projetos, aloca horas, (futuro) cede horas no remanejamento.
- **`coordenacao`** — somente leitura em tudo (relatórios, visão global). Não aloca, não arbitra, não cede.
- **`admin`** — administração técnica.
- **Colaborador NÃO é usuário** — é uma entidade de dados. Não tem login, não bate ponto. Tudo é cadastrado pelos gestores.

---

## 2. Decisões de produto travadas (não reabrir sem motivo forte)

Estas decisões foram debatidas (inclusive com revisão de IAs externas) e estão fechadas:

- **Teto de 220h fixo para todos**, por colaborador por mês, somando todas as alocações em todos os projetos de todos os gestores. É uma constante global no código (`TETO_HORAS_MES = 220`), não um campo por pessoa. Exceções (férias/licença) ficam para uma fase futura.
- **Ao atingir o teto, o sistema BLOQUEIA** (não pede aprovação a ninguém). Mostra ao gestor a distribuição atual: em quais projetos o colaborador já tem horas, quanto em cada, e de qual gestor é cada projeto. O destravamento, quando vier, será por **remanejamento entre gestores** (Fase 4), não por aprovação vertical.
- **Hierarquia:** Projeto → Macro-entrega → Micro-entrega. A alocação aponta para `colaborador + projeto + macro + micro + ano/mês`.
- **Micro "Geral" automática:** toda macro nasce com uma micro chamada "Geral". É o destino padrão de alocação quando o gestor não quer detalhar entregas. (Ver seção 5 sobre alocar "no nível da macro".)
- **Horas em `Decimal(6,2)`** — nunca `Float`.
- **Cadastro de colaborador:** qualquer gestor cadastra livremente. **E-mail é a chave única** (trava dura contra duplicata). **Nome** dispara uma busca de similaridade que apenas AVISA e pede confirmação — nunca bloqueia (dois "João Silva" legítimos podem coexistir).
- **Projeto:** tem um único gestor dono (relação 1:N), um código único e imutável, um nome, e **várias datas de prestação de contas** (1:N). Para priorização, conta a **próxima prestação ainda não vencida**.
- **Projetos são arquivados, nunca deletados.** O código fica preso para sempre, mesmo arquivado (nunca reutilizável).
- **Planejado E realizado:** ambos digitados pelo gestor (colaborador não acessa nada). O realizado entra no C3. O teto é sobre o **planejado**.
- **Remanejamento (Fase 4) — modelo broadcast:** o gestor sinaliza interesse num colaborador lotado e solicita uma parcela de horas; a pendência vai a todos os gestores que têm esse colaborador; cada um pode ceder uma parcela. Prioridade por data de prestação é só visual (ordena a fila, não dá direito automático). Cessão nunca ultrapassa o pedido.

### Riscos aceitos conscientemente
- Coordenação só-leitura pode "travar" o broadcast se os gestores não cederem horas — é uma aposta na transparência, não um bug.
- O realizado, sendo manual, pode nunca ser preenchido — o valor garantido do sistema está no planejamento; o realizado é um complemento.

---

## 3. Estado de execução por fase

| Fase | Conteúdo | Status |
|------|----------|--------|
| **Fase 0** | Fundação: remoção do legado, baseline de migrations, `requireRole`, seed de papéis | ✅ Completa (commit `4bc5683`) |
| **Fase 1** | Cadastros e hierarquia (Colaborador, Projeto, Macro/Micro) | ✅ Completa |
| **Fase 2 — C1** | Alocação de horas planejadas com teto de 220h + lock transacional | ✅ Completa |
| **Fase 2 — C2** | Grid de alocação (interface rica) | ⬜ Próximo passo |
| **Fase 2 — C3** | Horas realizadas + comparação planejado vs. realizado | ⬜ Pendente |
| **Fase 3** | Fechamento mensal + log de auditoria de edições | ⬜ Pendente |
| **Fase 4** | Remanejamento broadcast entre gestores | ⬜ Pendente |
| **Fase 5** | Relatórios da coordenação + escala (virtualização do grid) | ⬜ Pendente |
| Transversal | Identidade visual geral | ⬜ Pendente |

### Credenciais de teste (do seed)
| Papel | E-mail | Senha |
|-------|--------|-------|
| Admin | `admin@sistema.dev` | `admin123` |
| Coordenação | `coord@sistema.dev` | `coord123` |
| Gestor | `gestor1@sistema.dev` (+ gestor2, gestor3) | `gestor123` |

> Estas credenciais são descartáveis (desenvolvimento). Os usuários reais (20 gestores, coordenação) serão criados quando o sistema for implantado.

---

## 4. O que foi construído em detalhe

### Fase 0 — Fundação (commit `4bc5683`)
- Removidas todas as tabelas e código do domínio legado: `Task`, `TaskStep`, `TaskTag`, `TaskHistory`, `TimeEntry`, `Comment`, `Brand`, `Platform`, `Tag` — e o Kanban inteiro do frontend (Dashboard, Settings, modais, contexts).
- Mantida a infraestrutura reaproveitável: autenticação, `User`, notificações, push, password reset.
- Criado `requireRole(...roles)` genérico em `backend/src/middleware/auth.ts` (substituiu o antigo `requireAdmin`).
- Migrations reorganizadas via **baseline** (`20260602000000_fase0_baseline`) para sair do estado dessincronizado deixado por um `db push` anterior. **Lição:** sempre usar `migrate dev` (gera arquivo versionado), nunca `db push`, daqui em diante.
- Seed idempotente em `backend/src/db.ts`: zera e recria 1 admin + 1 coordenação + 3 gestores.

### Fase 1 — Cadastros e hierarquia

**B1 — Colaboradores** (commit `1e56947`)
- `backend/src/routes/colaboradores.ts` + `frontend/src/pages/Colaboradores.tsx`.
- Entidade Colaborador: `nome`, `email` (único), `funcao?`, `ativo`, auditoria.
- **Fluxo de duplicata em dois estágios:** e-mail duplicado → 409 (trava dura, não contornável nem com flag). Nome similar/idêntico → resposta `{ needsConfirmation, similares[] }` SEM criar; o frontend mostra os colaboradores em conflito com `[Cadastrar mesmo assim]` / `[Cancelar]`; só com `confirmarSimilar: true` é que cria. Similaridade via distância de Levenshtein.
- Coordenação lê, não cria.

**B2 — Projetos** (commit `7826482`)
- `backend/src/routes/projetos.ts` + `frontend/src/pages/Projetos.tsx`.
- Projeto: `codigo` (único, imutável, maiúsculo), `nome`, `gestorId` (= usuário logado sempre), `status`.
- **Várias datas de prestação de contas** (entidade `PrestacaoContas`, 1:N, tipo `DATE` puro). Migration preservou os dados existentes (copiou a data antiga antes de dropar a coluna).
- Backend calcula `proximaPrestacao { data, vencida }` (a menor data ainda não vencida; se todas venceram, a mais recente marcada como vencida).
- **Correção de fuso:** `@db.Date` no banco + `{ timeZone: 'UTC' }` na exibição — a data aparece exatamente como digitada, sem voltar um dia.
- Gestor vê só os próprios projetos; admin/coordenação veem todos. Arquiva via mudança de status, nunca deleta.

**B3 — Macro/Micro** (Fase 1 completa)
- `backend/src/routes/macros.ts` (montado em `/api/projetos/:projetoId/macros`) + `frontend/src/pages/ProjetoDetalhe.tsx` (rota `/projetos/:id`).
- **Ao criar uma Macro, cria junto (mesma transação) uma MicroEntrega "Geral".**
- Hard delete na macro (cascata nas micros via transação). Remover uma micro é bloqueado se ela for a **única** da macro (regra estrutural: uma macro nunca pode ficar sem destino de alocação).
- Gestor dono cria/edita; outros e coordenação só veem.

### Fase 2 — C1 — Núcleo do teto de 220h

**Tabela `alocacoes`** (migration `20260602000003_fase2_alocacoes`)
- Campos: `colaboradorId`, `projetoId`, `macroEntregaId`, `microEntregaId`, `ano`, `mes`, `horasPlanejadas` (`Decimal(6,2)`), `horasRealizadas` (`Decimal(6,2)` nullable — preparado para o C3), `createdById`/`updatedById` (auditoria), timestamps.
- **Índice único** em `(colaboradorId, projetoId, macroEntregaId, microEntregaId, ano, mes)` — impede a mesma alocação duplicada (o que bagunçaria a soma do teto).
- **Índice** em `(colaboradorId, ano, mes)` — é o que torna a soma do teto (e o lock) eficiente.
- Todas as FKs com `ON DELETE RESTRICT` — coerente com "arquivar, não deletar".

**Rota de alocação com lock** (`backend/src/routes/alocacoes.ts`)
- A verificação do teto e a gravação acontecem dentro de **uma única transação interativa** do Prisma.
- **Mecanismo do lock:** `SELECT id FROM colaboradores WHERE id = ? FOR UPDATE` adquire um lock exclusivo na linha do colaborador (serializa o acesso — o segundo gestor espera o primeiro terminar). A soma das horas usa `LOCK IN SHARE MODE` para ler os dados *committed* mais recentes, não o snapshot antigo. O lock é ancorado no colaborador (que sempre existe) e não nas linhas de alocação (que podem não existir na primeira alocação).
- Bloqueio retorna 409 com `totalAlocado`, `horasDisponiveis` e a `distribuicao` (projetos, horas e gestores).
- Permissão: só gestor e admin alocam; coordenação 403.
- **Validado com teste de concorrência:** `backend/test-concorrencia.mjs` dispara duas requisições simultâneas (via `Promise.all`) contra o mesmo colaborador/mês e confere o total real no banco. **16/16 rodadas corretas, o teto nunca furou.** Este arquivo deve ser mantido e re-executado sempre que algo perto da lógica de alocação mudar.
- Ajuste no B3: as rotas de delete de macro/micro agora checam alocações antes de deletar e retornam 400 com mensagem clara (consequência do `RESTRICT`).

---

## 5. Sobre alocar "no nível da macro" (sem descer até micro)

Pergunta recorrente: *é possível atribuir um colaborador a uma macro, sem escolher uma micro?*

**Resposta prática: sim — usando a micro "Geral".** A alocação no banco sempre aponta para uma micro específica (`microEntregaId` é obrigatório). Mas como toda macro nasce automaticamente com uma micro "Geral", alocar "na macro" significa, na prática, alocar na "Geral" daquela macro. Na tela isso se apresenta como alocar na macro; por baixo, registra na "Geral".

**Por que não tornar `microEntregaId` opcional?** Seria uma mudança de modelagem desaconselhada: quebraria a regra de unicidade da alocação e a integridade da soma do teto (uma alocação "solta" na macro não teria âncora estável, e o remanejamento da Fase 4 não teria onde pousar as horas cedidas). A micro "Geral" atende exatamente a mesma necessidade sem nenhum desses riscos. **Recomendação: manter como está.**

(Decisão para a interface do C2/C3: ao alocar na "Geral", a tela pode mostrar simplesmente o nome da macro, ou a macro com um rótulo "Geral" discreto — escolha de UX a definir, sem impacto no modelo de dados.)

---

## 6. Método de trabalho (manter)

O projeto vem sendo construído com um método que está funcionando e vale preservar:

- **Fases pequenas, testadas e aprovadas uma a uma** antes de seguir. Cada sub-bloco (B1, B2, B3, C1...) fecha com um commit, que vira um ponto de retorno seguro.
- **Operações estruturais (migrations, mudanças de schema) são mostradas ANTES de aplicar.** Especialmente quando há dados a preservar — ver o SQL e o antes/depois evita perda silenciosa.
- **Validação no navegador**, não só via API. Os testes automatizados provam a lógica; clicar na tela revela o que o plano no papel não captura. Várias melhorias (múltiplas datas de prestação, a confirmação de duplicata, o bug de fuso) surgiram exatamente assim.
- **Lógica crítica é testada isoladamente, com interface mínima, antes da interface rica.** O teto (C1) foi construído e provado com tela feia justamente para isolar o risco antes de construir o grid (C2).
- **Concorrência exige teste de concorrência.** Bugs de corrida não aparecem em teste manual — precisam de requisições paralelas disparadas de propósito, conferindo o estado real no banco.

### Ruído de teste a ignorar
- Avisos de PowerShell como `Join-String` inexistente, `$pid` reservado, `ConvertFrom-Json` — são da versão de PowerShell da máquina, não do sistema.
- `EADDRINUSE` (porta ocupada) — instância anterior do servidor ainda rodando; matar processos node resolve.
- Avisos `LF will be replaced by CRLF` no git — inofensivos (Windows).
- "Código já em uso" em testes repetidos — é o teste reusando um código já criado, não um bug.

---

## 7. Próximo passo: Fase 2 — C2 (Grid)

Com o teto provado e confiável, o C2 constrói a interface rica de alocação: **colaboradores nas linhas, alocação direta**. Agora é "só" frontend sobre uma fundação sólida — se algo quebrar, será visual e localizado, não um furo na regra central.

Pontos de atenção para o C2:
- A escala (200+ colaboradores × 12 meses) exige que o grid não seja ingênuo — virtualização/paginação serão necessárias (pode ficar para a Fase 5 se o C2 começar com um recorte menor, ex.: um mês por vez).
- O grid consome a mesma rota de alocação do C1 — o teto e o lock já estão prontos por baixo.
- A célula do grid, ao alocar, deve refletir o saldo do colaborador no mês e o bloqueio quando o teto é atingido.

### Dívida técnica anotada (não urgente)
1. O comentário sobre `innodb_lock_wait_timeout` em `alocarComLock` está com a redação contraditória (menciona 15s e 50s de forma confusa). A lógica está correta; é só o texto do comentário.
2. No C3, reavaliar se o lock precisa cobrir também atualizações de horas realizadas, ou se elas ficam fora do teto (provavelmente fora — o teto é sobre planejado — mas confirmar na hora).
3. A busca de similaridade de nome (B1) carrega todos os colaboradores e compara um a um. Para 200-300 está ótimo; só seria um problema em escala de milhares.

---

## 8. Documentos relacionados no projeto

- **`PLANO_FINAL.md`** — o plano consolidado (o "o quê" e "por quê" de todas as fases). Reflete as decisões finais.
- **`ANALISE_ADAPTACAO_OBSOLETO.md`** — análise antiga, superada. Mantida só por histórico. **Ignorar** (premissas abandonadas: aprovação vertical, TimeEntry, projeto-gestor M:N).
- **`CRITICA_DESIGN_v2.md`** — o prompt de crítica que foi levado às IAs externas (registro do brainstorm).
- **`PROGRESSO_E_DECISOES.md`** — este documento.
