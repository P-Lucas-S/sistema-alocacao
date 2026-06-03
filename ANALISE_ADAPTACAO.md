# Análise de Adaptação: Registro de Ponto → Gestão de Alocação de Equipes

> **Status:** Rascunho para revisão. Não escreva código com base neste documento antes de revisar os casos de borda da seção 6.
> **Gerado em:** 2026-06-02

---

## 1. Mapa do Sistema Atual

### Stack técnica

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 18+, TypeScript 5.8 |
| Framework backend | Express 4 |
| ORM | Prisma 6 com provider `mysql` |
| Banco de dados | MySQL/MariaDB (local: MariaDB 12.3) |
| Autenticação | JWT Bearer Token (jsonwebtoken), bcryptjs |
| E-mail | Nodemailer + Gmail SMTP |
| Push notifications | Web Push API (VAPID) |
| Runner dev | nodemon + tsx |
| Frontend | React 18 + TypeScript + Vite |
| Estilização | Tailwind CSS |
| Animações | Framer Motion |
| Roteamento | react-router-dom |
| Orquestração | concurrently (raiz) |

### Estrutura de pastas

```
registro-horas/
├── backend/
│   ├── src/
│   │   ├── server.ts            # Entry point, CORS, monta rotas
│   │   ├── db.ts                # initDb() — cria admin padrão no boot
│   │   ├── prisma.ts            # Singleton PrismaClient
│   │   ├── middleware/
│   │   │   └── auth.ts          # authenticate(), requireAdmin()
│   │   ├── routes/
│   │   │   ├── auth.ts          # Login, register, forgot/reset password
│   │   │   ├── tasks.ts         # CRUD de tarefas, timer, bulk actions, stats, reports
│   │   │   ├── users.ts         # CRUD de usuários (admin)
│   │   │   ├── profile.ts       # Edição de perfil próprio
│   │   │   ├── tags.ts          # CRUD de tags (admin)
│   │   │   ├── platforms.ts     # CRUD de plataformas
│   │   │   ├── brands.ts        # CRUD de marcas (clientes/brands)
│   │   │   ├── notifications.ts # Notificações in-app + push subscribe/unsubscribe
│   │   │   └── cron.ts          # Job de verificação de tarefas vencidas
│   │   └── services/
│   │       ├── emailService.ts  # Templates de e-mail (boas-vindas, reset, task assigned)
│   │       └── notificationService.ts # notify(), pushToUsers(), getAdminAndCoordinatorIds()
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── prisma.config.ts     # Configuração Prisma (carrega .env via dotenv)
│   │   └── migrations/
│   └── .env                     # Não commitado
└── frontend/
    └── src/
        ├── App.tsx              # Rotas + ProtectedRoute
        ├── types.ts             # Interfaces TypeScript compartilhadas
        ├── main.tsx
        ├── context/
        │   ├── AuthContext.tsx      # user, token, login, logout
        │   ├── BrandContext.tsx     # brands, selectedBrand (filtro global)
        │   ├── TagContext.tsx       # tags globais
        │   ├── PlatformContext.tsx  # plataformas globais
        │   ├── NotificationContext.tsx # polling de notificações
        │   └── ThemeContext.tsx     # dark/light theme
        ├── pages/
        │   ├── Login.tsx
        │   ├── ForgotPassword.tsx
        │   ├── ResetPassword.tsx
        │   ├── Dashboard.tsx        # Kanban principal (admin/coordenador/user)
        │   ├── SolicitanteDashboard.tsx # Kanban simplificado (papel solicitante)
        │   ├── Team.tsx             # Gestão de equipe (admin only)
        │   ├── Reports.tsx          # Relatórios de horas (admin only)
        │   ├── Settings.tsx         # Tags, plataformas, marcas (admin only)
        │   └── Profile.tsx          # Edição de perfil
        └── components/
            ├── Layout.tsx           # Shell com sidebar
            ├── NewTaskModal.tsx     # Formulário criação de tarefa
            ├── TaskDetailsModal.tsx # Detalhes + timer + histórico
            ├── FilterBar.tsx        # Filtros do kanban
            ├── BulkActionBar.tsx    # Ações em lote
            └── NotificationBell.tsx # Sino de notificações
```

### Modelos do schema.prisma

**User**
```
id           String   @id @db.VarChar(191)
name         String
email        String   @unique
passwordHash String
role         String   // valores conhecidos: 'admin', 'coordenador', 'user', 'solicitante'
position     String   // cargo textual livre
brands       String   // JSON serializado: ["brand-id-1", ...]
avatarUrl    String?  @db.LongText  // base64 ou URL
createdAt    DateTime @default(now())
```
Relações: assignedTasks, createdTasks, steps, timeEntries, comments, notifications, pushSubscriptions, taskHistory, passwordResets

**Task**
```
id               String    @id
title            String
description      String?   @db.Text
deadline         DateTime?
type             String    // tipo livre (ex: "design", "video")
status           String    // 'todo' | 'in_progress' | 'paused' | 'in_review' | 'done'
assigneeId       String?   // FK User (responsável atual)
creatorId        String    // FK User
network          String?
placement        String?
format           String?
sector           String?
direction        String?
reference        String?   @db.Text
referenceFiles   String?   @db.LongText  // JSON base64
materialType     String?
rejectionReason  String?   @db.Text
currentStepIndex Int       @default(0)
priority         String    // 'normal' | 'alta' | 'urgente'
brand            String?   // FK Brand (string ID)
createdAt        DateTime  @default(now())
```
Relações: assignee, creator, steps, timeEntries, comments, history, tags

**TaskStep** — etapa sequencial de uma tarefa
```
id           String    @id
taskId       String
userId       String    // quem executa esta etapa
stepOrder    Int
status       String    // 'pending' | 'done'
completedAt  DateTime?
instruction  String?
materialLink String?
comments     String?
pieces       Int       @default(0)
```

**TimeEntry** — registro de horas efetivas trabalhadas
```
id          String    @id
taskId      String
userId      String
startTime   DateTime
endTime     DateTime?
duration    Int       // segundos
pauseReason String?
status      String    // 'running' | 'paused' | 'completed'
createdAt   DateTime  @default(now())
```

**Comment** — comentários de tarefa

**Notification** — notificações in-app (lida/não-lida, com tipo e taskId opcional)

**PushSubscription** — subscriptions para Web Push VAPID

**TaskHistory** — auditoria de mudanças de status e ações em tarefas

**Tag / TaskTag** — etiquetas coloridas M:N com tarefas

**PasswordReset** — tokens de reset com hash SHA-256, expiração 30min

**Platform** — plataformas (Instagram, Meta, etc.) com ícone base64

**Brand** — marcas/clientes com logo e ícone base64 (claro/escuro)

### Endpoints do backend

| Método | Rota | Papel mínimo | Descrição |
|--------|------|-------------|-----------|
| POST | `/api/auth/register` | público | Cadastro de usuário |
| POST | `/api/auth/login` | público | Login + JWT |
| GET | `/api/auth/me` | autenticado | Dados do usuário logado |
| POST | `/api/auth/forgot-password` | público | Gera código reset |
| POST | `/api/auth/reset-password` | público | Aplica reset |
| GET | `/api/tasks` | autenticado | Lista tarefas (admin vê tudo, outros veem próprias) |
| POST | `/api/tasks` | autenticado | Cria tarefa |
| PUT | `/api/tasks/:id/status` | autenticado | Atualiza status (owner/admin) |
| POST | `/api/tasks/:id/review` | admin/coordenador | Aprova ou rejeita tarefa |
| POST | `/api/tasks/:id/transfer` | owner/admin | Reatribui tarefa |
| POST | `/api/tasks/:id/time/start` | autenticado | Inicia timer |
| POST | `/api/tasks/:id/time/pause` | autenticado | Pausa timer |
| GET | `/api/tasks/:id/time` | autenticado | Resumo de horas |
| GET | `/api/tasks/:id/comments` | autenticado | Lista comentários |
| POST | `/api/tasks/:id/comments` | autenticado | Adiciona comentário |
| PUT | `/api/tasks/bulk/status` | autenticado | Mudança em lote de status |
| PUT | `/api/tasks/bulk/assign` | autenticado | Reatribuição em lote |
| DELETE | `/api/tasks/bulk` | autenticado | Exclusão em lote |
| GET | `/api/tasks/stats` | admin | Cards de resumo |
| GET | `/api/tasks/reports` | admin | Relatório de horas por usuário/tarefa |
| GET | `/api/users` | autenticado | Lista usuários |
| POST | `/api/users` | admin | Cria usuário + envia e-mail boas-vindas |
| PUT | `/api/users/:id` | admin | Edita role/position/brands |
| DELETE | `/api/users/:id` | admin | Exclui usuário |
| POST | `/api/users/:id/reset-password` | admin | Reset de senha admin |
| PUT | `/api/profile/name` | autenticado | Atualiza nome próprio |
| PUT | `/api/profile/password` | autenticado | Troca senha própria |
| POST | `/api/profile/avatar` | autenticado | Upload avatar base64 |
| GET/POST/PUT/DELETE | `/api/tags` | admin (escrita) | CRUD de tags |
| GET/POST/PUT/DELETE | `/api/platforms` | autenticado | CRUD de plataformas |
| GET/POST/PUT/DELETE | `/api/brands` | autenticado | CRUD de marcas |
| GET | `/api/notifications/vapid-key` | público | Chave VAPID pública |
| POST | `/api/notifications/subscribe` | autenticado | Registra push subscription |
| POST | `/api/notifications/unsubscribe` | autenticado | Remove push subscription |
| GET | `/api/notifications` | autenticado | Lista notificações |
| PUT | `/api/notifications/:id/read` | autenticado | Marca como lida |
| PUT | `/api/notifications/read-all` | autenticado | Marca todas como lidas |
| GET | `/api/cron/overdue-tasks` | via secret | Job de tarefas vencidas |

### Telas/Páginas do frontend

| Rota | Componente | Acesso | Função |
|------|-----------|--------|--------|
| `/login` | `Login.tsx` | público | Login com email/senha + "lembrar-me" |
| `/forgot-password` | `ForgotPassword.tsx` | público | Solicita código de reset |
| `/reset-password` | `ResetPassword.tsx` | público | Aplica novo código |
| `/` | `Dashboard.tsx` | autenticado | Kanban com colunas: A Fazer / Em Andamento / Pausado / Revisão / Concluído |
| `/` (solicitante) | `SolicitanteDashboard.tsx` | role=solicitante | Kanban simplificado: Aguardando / Em Andamento / Concluído |
| `/team` | `Team.tsx` | admin | CRUD de usuários, atribuição de roles e brands |
| `/reports` | `Reports.tsx` | admin | Tabela de horas por usuário/tarefa, cards de stats |
| `/settings` | `Settings.tsx` | admin | Gerenciar tags, plataformas, marcas |
| `/profile` | `Profile.tsx` | autenticado | Editar nome, senha, avatar |

---

## 2. Modelo de Papéis Atual

### Papéis existentes

O campo `User.role` é uma string livre sem enum no banco. Os valores conhecidos pelo código:

| Role | Onde aparece | Permissões efetivas |
|------|-------------|---------------------|
| `admin` | `requireAdmin()`, checks inline em rotas | Acesso irrestrito: vê todas as tarefas, gerencia usuários, acessa relatórios, configurações, pode aprovar/rejeitar tarefas |
| `coordenador` | `getAdminAndCoordinatorIds()`, review endpoint | Pode aprovar/rejeitar tarefas em revisão. Recebe notificações de tarefas atrasadas. Não aparece em sidebar como papel distinto — usa o mesmo `Dashboard.tsx` do `user` |
| `user` | Default em registro | Vê apenas próprias tarefas (como assignee, creator ou step.userId). Cria tarefas, opera timer, comenta |
| `solicitante` | `RootDashboard` no App.tsx | Redireciona para `SolicitanteDashboard` — Kanban simplificado mostrando apenas suas solicitações |

**Observação crítica:** `coordenador` não tem sidebar diferenciada nem rotas exclusivas. Sua distinção é somente na lógica de revisão de tarefas e nas notificações. Na prática, visualmente o coordenador funciona como um `user` com permissão extra de revisão.

### Como a autenticação funciona

1. Login retorna JWT assinado com `{ id, role }`, expira em 1d (ou 30d com "lembrar-me").
2. Token armazenado em `sessionStorage` (padrão) ou `localStorage` (rememberMe).
3. Frontend envia `Authorization: Bearer <token>` em todas as requisições.
4. `authenticate()` middleware verifica e popula `req.user = { id, role }`.
5. `requireAdmin()` middleware bloqueia se `req.user.role !== 'admin'`.
6. Verificações de `coordenador` são inline nas rotas (não há `requireCoordenador()` genérico).
7. Não há refresh token — token expirado força novo login.

**Ponto fraco identificado:** Autorização baseada em string comparação inline, sem middleware padronizado para `coordenador`. Fácil de esquecer um check em rotas novas.

---

## 3. Gap Analysis

### O que reaproveitar sem mudança

| Componente | Motivo |
|-----------|--------|
| `User` model (campos base) | Colaboradores e gestores são Users. role pode ser extendido |
| `TimeEntry` model | É exatamente "horas realizadas" — já tem userId, taskId, duration |
| Middleware `authenticate()` | Funciona para qualquer rota nova |
| Serviço de notificações | notify(), push, DB — plugável em novos eventos |
| Serviço de e-mail | Templates são funções isoladas — fácil adicionar novos |
| Password reset flow | Sem alteração |
| Profile (nome, senha, avatar) | Sem alteração |
| Frontend: AuthContext, ThemeContext, NotificationBell | Reutilizáveis diretamente |
| Frontend: Layout + sidebar | Precisa de itens novos, mas a estrutura é aproveitável |
| Prisma config e migrations | Infraestrutura estável |

### O que precisa adaptar (não jogar fora, mas modificar)

| Componente | O que muda |
|-----------|------------|
| `User.role` | Adicionar `'gestor'` e `'coordenacao'` como valores formais. Avaliar se `coordenador` atual vira `coordenacao` ou coexiste |
| `requireAdmin()` | Virar um middleware mais genérico `requireRole(...roles)` para suportar `coordenacao` |
| Modelo de dados de `Brand` | Atualmente "brand" é client/marca. No novo sistema, projetos são entidades próprias — mas `Brand` poderia ser o "cliente do projeto". Reaproveitar como FK em `Projeto` |
| `User.brands` (JSON) | Hoje é `["brand-id"]` serializado. No novo modelo, vínculo gestor↔projeto é via `ProjetoGestor` (relação M:N) |
| Frontend `Team.tsx` | Adicionar assignment de papéis gestor/coordenacao |
| Frontend `Reports.tsx` | Expandir para mostrar planejado vs realizado por colaborador/mês |
| `notificationService.ts` | Adicionar novos tipos de notificação (`alocacao_solicitada`, `alocacao_aprovada`, `alocacao_rejeitada`) |

### O que criar do zero

| O que criar | Justificativa |
|------------|---------------|
| Entidade `Projeto` | Não existe. Brand não é um projeto |
| Entidade `MacroEntrega` | Não existe |
| Entidade `MicroEntrega` | Mais granular que `Task` (diferente semanticamente) |
| Entidade `Alocacao` | Core do novo sistema — horas planejadas por colaborador/mês/projeto |
| Entidade `SolicitacaoAprovacao` | Workflow de ultrapassagem do teto |
| Lógica de teto 220h | Precisa de query agregada cross-gestor, não existe nada parecido |
| Tela de planejamento mensal (gestor) | Grid colaborador × mês com horas planejadas/realizadas |
| Tela de capacidade (coordenação) | Visão agregada de todos os colaboradores e gestores |
| Tela de aprovações (coordenação) | Fila de solicitações pendentes |
| API de alocações | Todos os endpoints de CRUD + validação 220h |

---

## 4. Recomendação: Adaptar Incrementalmente

**Recomendação: adaptar o sistema existente, adicionando módulo paralelo.**

### Por quê não refazer do zero

O sistema atual tem infraestrutura valiosa e em funcionamento: auth, notificações (in-app + push), e-mail, Prisma com migrations, frontend com contextos e layout. Reescrever isso consumiria 30-40% do esforço total sem agregar valor ao novo problema.

O `TimeEntry` é especialmente valioso: já é a fonte da verdade de "horas realizadas" por usuário. O novo sistema simplesmente lê o que já existe para calcular o realizado.

### Por quê não reescrever o módulo de tarefas

O sistema de Kanban atual **pode coexistir** com o módulo de alocação. Os colaboradores ainda precisam de um lugar para gerenciar o trabalho do dia a dia (as tarefas concretas). O novo módulo é uma camada de **planejamento de capacidade** que existe acima disso, não em lugar disso.

### Risco da abordagem incremental

O maior risco é acúmulo de dívida de design no `User.role` (string livre sem enum) e na autorização inline. Antes de adicionar os novos papéis, vale criar um `requireRole()` genérico para evitar bugs silenciosos. Este é um pré-requisito técnico da Fase 1.

### Trade-off honesto

Se o sistema de Kanban atual não for mais necessário (a gestora só quer alocação, não acompanhamento de tarefas diárias), o código de `Task`, `TaskStep`, `TaskTag`, etc. vira dead weight. Nesse caso, o custo de manter é baixo (está no banco mas não é consultado), mas o custo cognitivo de manter duas semânticas diferentes numa mesma base é real. A recomendação é: **manter por enquanto, avaliar remoção na Fase 4** quando o módulo novo estiver maduro.

---

## 5. Proposta de Modelo de Dados Novo

### Novas entidades

```prisma
model Projeto {
  id          String    @id @db.VarChar(191)
  nome        String    @db.VarChar(255)
  codigo      String    @unique @db.VarChar(50)  // ex: "PROJ-2026-001"
  descricao   String?   @db.Text
  clienteId   String?   @db.VarChar(191)  // FK Brand (opcional)
  status      String    @default("ativo") @db.VarChar(50)  // 'ativo' | 'concluido' | 'arquivado'
  dataInicio  DateTime? @map("data_inicio")
  dataFim     DateTime? @map("data_fim")
  criadoPorId String    @map("criado_por_id") @db.VarChar(191)
  createdAt   DateTime  @default(now()) @map("created_at")

  criadoPor     User            @relation("ProjetoCriador", fields: [criadoPorId], references: [id])
  cliente       Brand?          @relation(fields: [clienteId], references: [id])
  macroEntregas MacroEntrega[]
  alocacoes     Alocacao[]
  gestores      ProjetoGestor[]

  @@map("projetos")
}

// Relação M:N Projeto ↔ Gestor (um projeto pode ter múltiplos gestores)
model ProjetoGestor {
  projetoId String @map("projeto_id") @db.VarChar(191)
  gestorId  String @map("gestor_id") @db.VarChar(191)
  createdAt DateTime @default(now()) @map("created_at")

  projeto Projeto @relation(fields: [projetoId], references: [id])
  gestor  User    @relation(fields: [gestorId], references: [id])

  @@id([projetoId, gestorId])
  @@map("projeto_gestores")
}

model MacroEntrega {
  id        String    @id @db.VarChar(191)
  projetoId String    @map("projeto_id") @db.VarChar(191)
  nome      String    @db.VarChar(255)
  descricao String?   @db.Text
  deadline  DateTime?
  status    String    @default("pendente") @db.VarChar(50)
  createdAt DateTime  @default(now()) @map("created_at")

  projeto        Projeto        @relation(fields: [projetoId], references: [id])
  microEntregas  MicroEntrega[]
  alocacoes      Alocacao[]

  @@map("macro_entregas")
}

model MicroEntrega {
  id             String    @id @db.VarChar(191)
  macroEntregaId String    @map("macro_entrega_id") @db.VarChar(191)
  nome           String    @db.VarChar(255)
  descricao      String?   @db.Text
  deadline       DateTime?
  status         String    @default("pendente") @db.VarChar(50)
  responsavelId  String?   @map("responsavel_id") @db.VarChar(191)
  createdAt      DateTime  @default(now()) @map("created_at")

  macroEntrega MacroEntrega @relation(fields: [macroEntregaId], references: [id])
  responsavel  User?        @relation(fields: [responsavelId], references: [id])
  alocacoes    Alocacao[]

  @@map("micro_entregas")
}

model Alocacao {
  id              String    @id @db.VarChar(191)
  colaboradorId   String    @map("colaborador_id") @db.VarChar(191)
  gestorId        String    @map("gestor_id") @db.VarChar(191)
  projetoId       String    @map("projeto_id") @db.VarChar(191)
  macroEntregaId  String?   @map("macro_entrega_id") @db.VarChar(191)
  microEntregaId  String?   @map("micro_entrega_id") @db.VarChar(191)
  ano             Int
  mes             Int       // 1–12
  horasPlanejadas Float     @map("horas_planejadas")
  // horasRealizadas é calculado on-the-fly via TimeEntry, não armazenado aqui
  // (evita dessincronização; ver nota abaixo)
  status          String    @default("ativa") @db.VarChar(50)
  // 'ativa' | 'pendente_aprovacao' | 'aprovada_excecao' | 'rejeitada'
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  colaborador  User           @relation("AlocacaoColaborador", fields: [colaboradorId], references: [id])
  gestor       User           @relation("AlocacaoGestor", fields: [gestorId], references: [id])
  projeto      Projeto        @relation(fields: [projetoId], references: [id])
  macroEntrega MacroEntrega?  @relation(fields: [macroEntregaId], references: [id])
  microEntrega MicroEntrega?  @relation(fields: [microEntregaId], references: [id])
  solicitacao  SolicitacaoAprovacao?

  @@unique([colaboradorId, projetoId, macroEntregaId, microEntregaId, ano, mes])
  @@index([colaboradorId, ano, mes])
  @@map("alocacoes")
}

model SolicitacaoAprovacao {
  id                String    @id @db.VarChar(191)
  alocacaoId        String    @unique @map("alocacao_id") @db.VarChar(191)
  solicitanteId     String    @map("solicitante_id") @db.VarChar(191)  // gestor
  aprovadorId       String?   @map("aprovador_id") @db.VarChar(191)    // coordenação
  horasSolicitadas  Float     @map("horas_solicitadas")
  horasJaAlocadas   Float     @map("horas_ja_alocadas")  // snapshot no momento da solicitação
  horasDisponiveis  Float     @map("horas_disponiveis")  // 220 - horasJaAlocadas no momento
  status            String    @default("pendente") @db.VarChar(50)
  // 'pendente' | 'aprovada' | 'rejeitada'
  motivoRejeicao    String?   @map("motivo_rejeicao") @db.Text
  createdAt         DateTime  @default(now()) @map("created_at")
  resolvidoEm       DateTime? @map("resolvido_em")

  alocacao    Alocacao @relation(fields: [alocacaoId], references: [id])
  solicitante User     @relation("SolicitacaoSolicitante", fields: [solicitanteId], references: [id])
  aprovador   User?    @relation("SolicitacaoAprovador", fields: [aprovadorId], references: [id])

  @@index([status])
  @@map("solicitacoes_aprovacao")
}
```

### Como "planejado vs realizado" funciona

**Planejado (`horasPlanejadas`):** armazenado diretamente em `Alocacao`. O gestor define quantas horas planeja alocar aquele colaborador naquele mês naquele projeto.

**Realizado (calculado):** derivado de `TimeEntry`. A query agrega segundos de todas as `TimeEntry` do colaborador no período (ano/mês), convertidos para horas. O vínculo entre `TimeEntry` e a alocação é indireto: `TimeEntry.taskId` → `Task` → (pode ou não estar ligada a uma `MicroEntrega`).

```
-- Pseudo-query de horas realizadas por colaborador/mês
SELECT
  userId,
  YEAR(startTime) as ano,
  MONTH(startTime) as mes,
  SUM(duration) / 3600 as horas_realizadas
FROM time_entries
WHERE status IN ('completed', 'paused')
GROUP BY userId, YEAR(startTime), MONTH(startTime)
```

**Nota de design:** `horasRealizadas` não é armazenada em `Alocacao` para evitar dessincronização com `TimeEntry`. Toda tela que precisa do realizado faz a query agregada. Se performance for problema futuro, um campo desnormalizado com job de sync pode ser adicionado sem breaking change.

### Cálculo do teto de 220h

```
horasAlocadasNoMes(colaboradorId, ano, mes) =
  SUM(horasPlanejadas)
  FROM alocacoes
  WHERE colaboradorId = X
    AND ano = Y AND mes = Z
    AND status IN ('ativa', 'pendente_aprovacao', 'aprovada_excecao')
  -- inclui pendentes para evitar race condition (ver seção 6)
```

Quando um gestor tenta criar/atualizar uma alocação:
1. Calcular `horasAtuais = horasAlocadasNoMes(colaborador, ano, mes)`
2. Se `horasAtuais + novasHoras <= 220` → salva direto com `status = 'ativa'`
3. Se `horasAtuais + novasHoras > 220` → cria com `status = 'pendente_aprovacao'` + cria `SolicitacaoAprovacao`

### Relação com o modelo existente

- `User` → sem mudança estrutural, apenas novos valores de `role`
- `TimeEntry` → continua sendo a fonte de horas realizadas (por tarefa, por usuário)
- `Brand` → pode virar FK opcional em `Projeto.clienteId` (sem breaking change)
- `Task` / `TaskStep` → coexistem sem mudança; podem futuramente receber FK `microEntregaId` para vincular trabalho diário ao planejamento

---

## 6. Casos de Borda da Regra das 220h

Esta seção levanta problemas sem necessariamente resolvê-los — são pontos para decisão antes da implementação.

### 6.1 Alocações pendentes contam para o teto?

**Problema:** Se pendentes **não contam**, dois gestores podem criar solicitações simultâneas para o mesmo colaborador. Ambas parecem válidas na hora do check. Ambas chegam à coordenação. A coordenação aprova as duas. Total ultrapassa 220h.

**Problema inverso:** Se pendentes **contam**, um gestor mal-intencionado pode "congelar" toda a capacidade de um colaborador criando uma solicitação enorme que fica pendente indefinidamente.

**Decisão sugerida:** Pendentes **contam** para o check, mas com validade máxima (ex: 72h). Se a coordenação não resolver em 72h, a solicitação expira e a capacidade é liberada. A coordenação recebe alerta de prazo expirando.

### 6.2 Race condition entre dois gestores simultâneos

**Cenário:** Colaborador tem 200h alocadas. Gestores A e B verificam ao mesmo tempo: ambos veem 20h disponíveis. Ambos tentam alocar 20h. Ambos passam do check. Total: 240h.

**Solução técnica necessária:** A operação de "verificar + criar alocação" deve ser atômica. Opções:
- **Transação com SELECT FOR UPDATE** no MariaDB (bloqueia a linha do colaborador/mês)
- **Constraint única no banco** com fallback gracioso: `@@unique([colaboradorId, projetoId, macroEntregaId, microEntregaId, ano, mes])` já evita duplicatas, mas não a race condition de soma
- **Tabela de capacidade desnormalizada** com update atômico (mais complexo)

A solução mais simples para o MVP: transação com `prisma.$transaction` + `$queryRaw("SELECT ... FOR UPDATE")`.

### 6.3 Aprovação parcial

**Cenário:** Gestor solicita 40h excedentes. Coordenação acha 20h razoável.

**O sistema atual proposto:** aprova ou rejeita inteiramente. Não há aprovação parcial.

**Decisão necessária:** Implementar aprovação parcial exige um campo `horasAprovadas` em `SolicitacaoAprovacao` e lógica adicional no backend. É uma feature de UX importante, mas aumenta a complexidade da Fase 2.

**Sugestão:** começar sem aprovação parcial; a coordenação rejeita e o gestor recria com menos horas.

### 6.4 Meses parciais

**Problema:** Colaborador contratado em 15/03. Faz sentido alocar 220h em março quando só trabalhou metade do mês?

**Opções:**
1. Teto fixo de 220h independente de quando entrou (simples, mas injusto)
2. Campo `capacidadeCustomizada` por usuário/mês na tabela de capacidade (flexível, mas requer UI extra)
3. Regra de negócio fora do sistema: gestores são responsáveis por ajustar manualmente

**Não há dados suficientes para decidir.** Marcar como **"fora do escopo da Fase 1"**, usar teto fixo por enquanto.

### 6.5 Férias e ausências

**Problema:** Colaborador de férias em julho. Gestores não deveriam poder alocar 220h para esse mês.

**Solução simples:** `CapacidadeColaborador` — tabela que permite sobrescrever o teto padrão por usuário/mês. Se não existir registro, assume 220h. Coordenação pode definir 0h para meses de férias.

```prisma
model CapacidadeColaborador {
  id            String @id
  colaboradorId String
  ano           Int
  mes           Int
  horasMaximas  Float  @default(220)
  motivo        String?  // "férias", "licença", etc.

  @@unique([colaboradorId, ano, mes])
}
```

### 6.6 O que acontece com horas realizadas > planejadas?

O sistema **não bloqueia** o colaborador de trabalhar mais horas. `TimeEntry` continua registrando. O campo realizado simplesmente fica acima do planejado, aparece em vermelho nos relatórios, e é uma divergência para análise do gestor. Não é tratado como erro — é informação.

### 6.7 Exclusão/redução de alocação que estava no teto

Se um gestor reduz de 50h para 30h uma alocação de um colaborador que estava com 220h, os 20h "liberados" ficam disponíveis para outros gestores. O sistema precisa notificar coordenação? Provavelmente não — é uma liberação de capacidade, não um evento crítico.

### 6.8 Aprovação retroativa

**Cenário:** Solicitação criada em março para o mês de março (mês em curso). Coordenação aprova em abril. As horas foram trabalhadas mas a alocação ficou "pendente" no histórico.

**Decisão necessária:** A alocação aprovada retroativamente deve mudar de status para `'aprovada_excecao'` independente da data de aprovação. O realizado (TimeEntry) já existia; o planejado só agora é formalizado. Para relatórios históricos, isso cria uma inconsistência temporal. **Sugestão:** armazenar `aprovadoEm` em `SolicitacaoAprovacao` e deixar claro nos relatórios quando a aprovação foi retroativa.

---

## 7. Proposta de Telas

### Papel: Gestor

| Tela | Descrição |
|------|-----------|
| **Meus Projetos** (`/projetos`) | Lista de projetos onde o gestor está vinculado. Cards com status, % de horas planejadas vs realizadas no mês |
| **Detalhe do Projeto** (`/projetos/:id`) | Hierarquia Macro → Micro. Botão para alocar colaborador por mês |
| **Planejamento Mensal** (`/projetos/:id/alocacao`) | Grid: linhas = colaboradores, colunas = meses. Células editáveis com horas planejadas. Indicador visual de limite: verde (<80%), amarelo (80-100%), vermelho (>100% — entra em solicitação) |
| **Minhas Solicitações** (`/solicitacoes`) | Lista de solicitações pendentes/aprovadas/rejeitadas que o gestor criou |

### Papel: Coordenação

| Tela | Descrição |
|------|-----------|
| **Painel de Capacidade** (`/capacidade`) | Tabela com todos os colaboradores × meses. Heatmap de ocupação. Filtros por projeto/gestor |
| **Fila de Aprovações** (`/aprovacoes`) | Lista de solicitações pendentes, ordenadas por urgência. Ações: Aprovar / Rejeitar com campo de motivo |
| **Configuração de Capacidade** (`/capacidade/config`) | Definir teto customizado por colaborador/mês (férias, licenças) |
| **Relatório Planejado vs Realizado** (`/relatorios/alocacao`) | Tabela comparativa por colaborador/mês/projeto. Exportação CSV |

### Papel: Colaborador

| Tela | Descrição |
|------|-----------|
| **Minha Alocação** (tab na `/profile` ou rota própria) | Visão read-only do que foi planejado para si por mês/projeto. Comparativo com horas reais do timer |

### Modificações em telas existentes

| Tela | Modificação |
|------|-----------|
| `/team` | Adicionar filtro por role gestor/colaborador. Mostrar carga mensal do colaborador na listagem |
| `/reports` | Adicionar aba "Alocação" com planejado vs realizado |
| Sidebar (`Layout.tsx`) | Novos itens: Projetos, Capacidade (coordenação), Aprovações (coordenação) |

---

## 8. Plano de Implementação Faseado

### Fase 0 — Pré-requisitos técnicos (não bloqueante para design, bloqueante para código)

**Objetivo:** Resolver dívidas técnicas que afetariam as fases seguintes.

1. Criar `requireRole(...roles: string[])` no `auth.ts` substituindo checks inline
2. Definir valores formais de role: decidir se `coordenador` atual vira `coordenacao` ou coexiste como alias
3. Adicionar `gestor` como role válido nos checks de autorização
4. Criar seed de usuários de teste (admin, gestor, coordenação, 3 colaboradores)

**Critério de aceite:** Um usuário com role `gestor` consegue logar, vê o dashboard atual, e não acessa `/team` nem `/reports`.

---

### Fase 1 — Modelo de dados e migrations

**Objetivo:** Banco reflete o novo domínio. Nenhuma UI ainda.

1. Adicionar `CapacidadeColaborador` ao schema (teto configurável)
2. Adicionar `Projeto`, `ProjetoGestor`, `MacroEntrega`, `MicroEntrega`
3. Adicionar `Alocacao` com índice `[colaboradorId, ano, mes]`
4. Adicionar `SolicitacaoAprovacao`
5. Adicionar FK `Brand.id` opcional em `Projeto`
6. Rodar `prisma migrate dev --name feat_alocacao`

**Critério de aceite:** Migration aplica sem erro no MariaDB local. Prisma Client gerado sem erros de tipo. Inserção manual de dados de teste via prisma studio.

---

### Fase 2 — API de projetos e alocações (backend)

**Objetivo:** Endpoints funcionam e a regra das 220h é validada.

1. `GET/POST /api/projetos` — listar e criar projetos
2. `GET/PUT/DELETE /api/projetos/:id` — detalhe, editar, arquivar
3. `POST /api/projetos/:id/gestores` — vincular gestor ao projeto
4. `GET/POST /api/projetos/:id/macro-entregas` — CRUD macro-entregas
5. `GET/POST /api/macro-entregas/:id/micro-entregas` — CRUD micro-entregas
6. `POST /api/alocacoes` — criar alocação com verificação de teto (transação atômica)
7. `GET /api/alocacoes?colaboradorId=&ano=&mes=` — consultar alocações
8. `PUT /api/alocacoes/:id` — atualizar horas planejadas (re-valida teto)
9. `GET /api/aprovacoes` — listar solicitações (coordenação)
10. `PUT /api/aprovacoes/:id` — aprovar/rejeitar (coordenação)
11. `GET /api/capacidade?ano=&mes=` — visão agregada (coordenação)

**Critério de aceite:** Teste com curl/Insomnia: criar dois colaboradores, gestor tenta alocar 220h no projeto A → sucesso. Mesmo gestor tenta alocar 10h a mais → retorna 422 com `status: 'solicitacao_criada'`. Coordenação aprova → alocação muda de status.

---

### Fase 3 — Telas do gestor (frontend)

**Objetivo:** Gestor consegue criar projetos e alocar colaboradores.

1. Criar `ProjectContext` (análogo ao `BrandContext`)
2. Tela `/projetos` — listagem de projetos
3. Tela `/projetos/:id` — hierarquia macro/micro + botão alocar
4. Tela `/projetos/:id/alocacao` — grade mensal com células editáveis
5. Feedback visual do teto: verde/amarelo/vermelho
6. Tela `/solicitacoes` — minhas solicitações pendentes

**Critério de aceite:** Gestor consegue criar projeto, adicionar macro/micro-entrega, alocar colaborador por mês, ver aviso visual quando ultrapassa 220h, e ver status da solicitação.

---

### Fase 4 — Telas da coordenação (frontend)

**Objetivo:** Coordenação consegue visualizar capacidade global e resolver aprovações.

1. Tela `/capacidade` — heatmap de todos os colaboradores
2. Tela `/aprovacoes` — fila de aprovações com ação inline
3. Tela `/capacidade/config` — configurar teto por colaborador/mês
4. Notificações automáticas quando nova solicitação chega
5. Itens novos na sidebar condicionados ao role

**Critério de aceite:** Coordenação aprova/rejeita via UI, colaborador aparece desbloqueado no grid do gestor, notificação chega ao gestor.

---

### Fase 5 — Relatórios e visão do colaborador

**Objetivo:** Dados acessíveis por todos os papéis.

1. Tab "Alocação" na tela `/reports` (admin) — planejado vs realizado por mês
2. Visão "Minha Alocação" no `/profile` (colaborador)
3. Exportação CSV do relatório de alocação

**Critério de aceite:** Admin consegue ver, para qualquer colaborador em qualquer mês, horas planejadas (soma de `Alocacao.horasPlanejadas`) vs realizadas (soma de `TimeEntry.duration / 3600`).

---

### Fase 6 — Integração Task ↔ MicroEntrega (opcional)

**Objetivo:** Tarefas diárias do Kanban são linkadas ao planejamento.

1. Adicionar FK opcional `microEntregaId` em `Task`
2. Filtro de tarefas por entrega
3. `TimeEntry` agrupado por `MicroEntrega` no relatório

**Critério de aceite:** Ao criar tarefa, gestor pode vincular a uma micro-entrega. Horas realizadas naquela tarefa aparecem no relatório da entrega.

> **Nota:** Esta fase pode ser descartada se o uso do Kanban for descontinuado. Decidir após a Fase 4 estar estável.

---

## Apêndice: Questões abertas para revisão

Antes de iniciar a Fase 1, as seguintes questões precisam de decisão do stakeholder:

1. **Aprovação parcial:** coordenação pode aprovar menos horas do que as solicitadas?
2. **Validade de solicitações pendentes:** quanto tempo uma solicitação fica em aberto antes de expirar?
3. **Meses parciais e férias:** usar `CapacidadeColaborador` ou teto fixo de 220h para o MVP?
4. **Coexistência do Kanban:** os colaboradores continuam usando o sistema de tarefas atual junto com o novo módulo de alocação?
5. **Roles:** `coordenador` atual (aprovação de tarefas) e `coordenacao` novo (aprovação de alocações) são o mesmo papel ou papéis distintos?
6. **Granularidade da alocação:** é obrigatório vincular a uma MacroEntrega/MicroEntrega, ou basta o projeto + mês?
