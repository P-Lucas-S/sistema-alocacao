import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, Search, Pencil, PowerOff, Power, X, AlertTriangle } from 'lucide-react';

interface Colaborador {
  id: string;
  nome: string;
  email: string;
  funcao: string | null;
  valorHora: string | null;
  ativo: boolean;
  createdAt: string;
  createdBy?: { name: string };
}

interface Similar {
  nome: string;
  email: string;
  funcao: string | null;
}

interface Categoria {
  id: string;
  nome: string;
  ativo: boolean;
}

interface TarifaInput {
  categoriaId: string;
  valorHora: number;
}

// Dados do formulário prontos para reenvio com confirmarSimilar: true
interface PendingCreate {
  nome: string;
  email: string;
  funcao: string | null;
  valorHora: number;
  tarifas: TarifaInput[];
  similares: Similar[];
}

const FUNCOES_COMUNS = ['Designer', 'Redator', 'Editor de Vídeo', 'Motion Designer', 'Social Media', 'Desenvolvedor'];

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none', width: '100%',
};

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} style={{ ...inputStyle, ...props.style }} />
);

const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} style={{ ...inputStyle, ...props.style }} />
);

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
      {label}
    </label>
    {children}
    {hint && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{hint}</p>}
  </div>
);

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(n => n[0] ?? '').join('').toUpperCase();
}
const COLORS = ['#818cf8', '#34d399', '#fb923c', '#f472b6', '#60a5fa', '#a78bfa', '#2dd4bf'];
const avatarColor = (name: string) => COLORS[name.charCodeAt(0) % COLORS.length];

export default function Colaboradores() {
  const { token, user } = useAuth();
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filterAtivo, setFilterAtivo] = useState<'true' | 'false' | ''>('true');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editTarget, setEditTarget]   = useState<Colaborador | null>(null);

  // Form fields
  const [nome, setNome]       = useState('');
  const [email, setEmail]     = useState('');
  const [funcao, setFuncao]   = useState('');
  const [customFuncao, setCustomFuncao] = useState('');
  const [valorHora, setValorHora] = useState('');

  // Tarifas por categoria (overrides) — categoriaId -> valor digitado (string, vazio = sem override)
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [tarifasLoading, setTarifasLoading] = useState(false);
  // tarifasCarregadas: só true quando é seguro mandar `tarifas` no PUT (criar não depende de fetch).
  // tarifasFetchErro: GET /:id falhou — overrides nos inputs não refletem a realidade, NÃO enviar.
  const [tarifasCarregadas, setTarifasCarregadas] = useState(true);
  const [tarifasFetchErro, setTarifasFetchErro] = useState(false);

  // Confirmation flow (stage 2)
  const [pending, setPending]   = useState<PendingCreate | null>(null);

  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  const canWrite = user?.role === 'admin' || user?.role === 'gestor';

  const fetchColaboradores = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterAtivo !== '') params.set('ativo', filterAtivo);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/colaboradores?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setColaboradores(await res.json());
    } finally {
      setLoading(false);
    }
  }, [token, search, filterAtivo]);

  useEffect(() => { fetchColaboradores(); }, [fetchColaboradores]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => fetchColaboradores(), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchCategorias = useCallback(async () => {
    const res = await fetch('/api/categorias?ativo=true', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setCategorias(await res.json());
  }, [token]);

  useEffect(() => { fetchCategorias(); }, [fetchCategorias]);

  function placeholderPadrao() {
    const num = parseFloat(valorHora);
    if (valorHora.trim() === '' || isNaN(num)) return 'padrão: —';
    return `padrão: ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // ── Modal helpers ──────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null);
    setNome(''); setEmail(''); setFuncao(''); setCustomFuncao(''); setValorHora('');
    setOverrides({});
    setTarifasCarregadas(true); setTarifasFetchErro(false); // criar não depende de fetch — sempre seguro
    setError(''); setPending(null);
    setIsModalOpen(true);
  }

  async function openEdit(c: Colaborador) {
    setEditTarget(c);
    setNome(c.nome);
    setEmail(c.email);
    const isPredefined = FUNCOES_COMUNS.includes(c.funcao ?? '');
    setFuncao(isPredefined ? (c.funcao ?? '') : (c.funcao ? '__custom__' : ''));
    setCustomFuncao(isPredefined ? '' : (c.funcao ?? ''));
    setValorHora(c.valorHora != null ? c.valorHora : '');
    setOverrides({});
    setTarifasCarregadas(false); setTarifasFetchErro(false); // só fica true após o GET ter sucesso
    setError(''); setPending(null);
    setIsModalOpen(true);

    // Busca o detalhe pra pré-preencher os overrides existentes (a lista não os traz).
    // Enquanto isso não terminar (ou se falhar), o PUT não pode mandar `tarifas` —
    // senão um array vazio apagaria os overrides reais no backend.
    setTarifasLoading(true);
    try {
      const res = await fetch(`/api/colaboradores/${c.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const detail = await res.json();
        if (detail.valorHora != null) setValorHora(String(parseFloat(detail.valorHora)));
        const map: Record<string, string> = {};
        for (const t of detail.tarifas ?? []) {
          map[t.categoriaId] = String(parseFloat(t.valorHora));
        }
        setOverrides(map);
        setTarifasCarregadas(true);
      } else {
        setTarifasFetchErro(true);
      }
    } catch {
      setTarifasFetchErro(true);
    } finally {
      setTarifasLoading(false);
    }
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditTarget(null);
    setPending(null);
    setError('');
    setOverrides({});
  }

  function cancelConfirmation() {
    // Volta ao formulário com campos intactos, sem criar nada
    setPending(null);
    setError('');
  }

  function effectiveFuncao() {
    return funcao === '__custom__' ? customFuncao.trim() : funcao;
  }

  // ── Estágio 1: submit do formulário ────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Valor-hora padrão é obrigatório — bloqueia ANTES de chamar a API
    const valorHoraTrim = valorHora.trim();
    const valorHoraNum = parseFloat(valorHoraTrim);
    if (valorHoraTrim === '' || isNaN(valorHoraNum) || valorHoraNum <= 0) {
      setError('Informe o valor-hora padrão do colaborador (maior que zero).');
      return;
    }

    // Monta tarifas só com os inputs preenchidos e válidos; em branco = sem override
    const tarifas: TarifaInput[] = [];
    for (const cat of categorias) {
      const raw = overrides[cat.id];
      if (raw === undefined || raw.trim() === '') continue;
      const num = parseFloat(raw);
      if (isNaN(num) || num <= 0) {
        setError(`Valor inválido para a categoria "${cat.nome}" — informe um número maior que zero ou deixe em branco.`);
        return;
      }
      tarifas.push({ categoriaId: cat.id, valorHora: num });
    }

    setSaving(true);
    try {
      if (editTarget) {
        // Edição não tem fluxo de confirmação.
        // `tarifas` só entra no body se o GET de overrides já carregou com sucesso —
        // senão omitimos o campo (backend preserva os overrides existentes).
        const body: Record<string, unknown> = { nome: nome.trim(), funcao: effectiveFuncao() || null, valorHora: valorHoraNum };
        if (tarifasCarregadas) body.tarifas = tarifas;

        const res  = await fetch(`/api/colaboradores/${editTarget.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Erro ao salvar'); return; }
        closeModal();
        fetchColaboradores();
        return;
      }

      // Criação — estágio 1
      const body = { nome: nome.trim(), email: email.trim(), funcao: effectiveFuncao() || null, valorHora: valorHoraNum, tarifas };
      const res = await fetch('/api/colaboradores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.status === 200 && data.needsConfirmation) {
        // Pausa: mostra tela de confirmação sem criar nada
        setPending({ ...body, similares: data.similares });
        return;
      }

      if (!res.ok) { setError(data.error || 'Erro ao salvar'); return; }

      // 201 — criado com sucesso (sem conflito de nome)
      closeModal();
      fetchColaboradores();
    } catch {
      setError('Erro de rede');
    } finally {
      setSaving(false);
    }
  }

  // ── Estágio 2: usuário confirma "cadastrar mesmo assim" ────────────────
  async function handleConfirm() {
    if (!pending) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/colaboradores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...pending, confirmarSimilar: true }),
      });
      const data = await res.json();

      if (!res.ok) {
        // E-mail entrou em conflito entre o primeiro e segundo envio — improvável mas possível
        setError(data.error || 'Erro ao salvar');
        setPending(null);
        return;
      }

      closeModal();
      fetchColaboradores();
    } catch {
      setError('Erro de rede');
    } finally {
      setSaving(false);
    }
  }

  // ── Toggle ativo ────────────────────────────────────────────────────────
  async function toggleAtivo(c: Colaborador) {
    try {
      await fetch(`/api/colaboradores/${c.id}/ativo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ativo: !c.ativo }),
      });
      fetchColaboradores();
    } catch { /* silently fail */ }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <Users size={20} style={{ color: 'var(--brand-500)' }} />
            Colaboradores
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
            {loading ? '…' : `${colaboradores.length} encontrado${colaboradores.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: 'var(--brand-500)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.9'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          >
            <UserPlus size={15} />
            Novo Colaborador
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            style={{ ...inputStyle, paddingLeft: 34, background: 'var(--surface-1)' }}
          />
        </div>
        <Select value={filterAtivo} onChange={e => setFilterAtivo(e.target.value as any)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
          <option value="">Todos</option>
        </Select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Carregando…
        </div>
      ) : colaboradores.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2" style={{ color: 'var(--text-3)' }}>
          <Users size={40} strokeWidth={1} />
          <p className="text-sm">Nenhum colaborador encontrado.</p>
          {canWrite && (
            <button onClick={openCreate} className="text-sm font-medium mt-1" style={{ color: 'var(--brand-500)' }}>
              + Cadastrar primeiro colaborador
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {colaboradores.map(c => {
            const ac = avatarColor(c.nome);
            return (
              <div
                key={c.id}
                className="rounded-2xl p-4 flex items-start gap-4 transition-all"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', opacity: c.ativo ? 1 : 0.55 }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: ac + '22', color: ac }}>
                  {initials(c.nome)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>{c.nome}</span>
                    {!c.ativo && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'hsl(0 0% 50% / 0.12)', color: 'var(--text-3)' }}>
                        Inativo
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{c.email}</p>
                  {c.funcao && <p className="text-xs mt-0.5 font-medium" style={{ color: 'var(--brand-500)' }}>{c.funcao}</p>}
                  {c.valorHora != null && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                      R$ {parseFloat(c.valorHora).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/h
                    </p>
                  )}
                  {canWrite && (
                    <div className="flex items-center gap-1.5 mt-2.5">
                      <button onClick={() => openEdit(c)} className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg" style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                        <Pencil size={11} /> Editar
                      </button>
                      <button onClick={() => toggleAtivo(c)} className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg" style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = c.ativo ? '#f87171' : '#4ade80'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                        {c.ativo ? <><PowerOff size={11} /> Desativar</> : <><Power size={11} /> Ativar</>}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'hsl(0 0% 0% / 0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-5"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>
                  {pending ? 'Nome em conflito — confirmar?' : editTarget ? 'Editar Colaborador' : 'Novo Colaborador'}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {pending
                    ? 'Já existem colaboradores com nome parecido. Verifique se não é a mesma pessoa.'
                    : editTarget
                      ? `Editando ${editTarget.nome}`
                      : 'E-mail é chave única — não admite duplicata.'}
                </p>
              </div>
              <button onClick={closeModal} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: 'var(--text-3)' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <X size={16} />
              </button>
            </div>

            {/* Erro global */}
            {error && (
              <div className="p-3 rounded-xl text-sm" style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 65%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>
                {error}
              </div>
            )}

            {/* ── Estágio 2: tela de confirmação ── */}
            {pending ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'hsl(38 92% 50% / 0.1)', border: '1px solid hsl(38 92% 50% / 0.3)' }}>
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
                  <p className="text-sm" style={{ color: '#fbbf24' }}>
                    Você está tentando cadastrar <strong>{pending.nome}</strong>.
                    {pending.similares.length === 1 ? ' Já existe um colaborador com nome muito parecido:' : ` Já existem ${pending.similares.length} colaboradores com nomes parecidos:`}
                  </p>
                </div>

                {/* Conflitantes */}
                <div className="flex flex-col gap-2">
                  {pending.similares.map((s, i) => {
                    const ac = avatarColor(s.nome);
                    return (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0" style={{ background: ac + '22', color: ac }}>
                          {initials(s.nome)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{s.nome}</p>
                          <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{s.email}</p>
                          {s.funcao && <p className="text-xs font-medium" style={{ color: 'var(--brand-500)' }}>{s.funcao}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Se for uma pessoa diferente, clique em <strong>Cadastrar mesmo assim</strong>. Se for a mesma, clique em <strong>Cancelar</strong> e corrija os dados.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={cancelConfirmation}
                    disabled={saving}
                    className="flex-1 py-2 px-4 rounded-xl text-sm font-medium"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={saving}
                    className="flex-1 py-2 px-4 rounded-xl text-sm font-semibold text-white"
                    style={{ background: 'var(--brand-500)', opacity: saving ? 0.7 : 1 }}
                  >
                    {saving ? 'Cadastrando…' : 'Cadastrar mesmo assim'}
                  </button>
                </div>
              </div>
            ) : (
              /* ── Estágio 1: formulário normal ── */
              <form onSubmit={handleSave} className="flex flex-col gap-4">
                <Field label="Nome completo">
                  <Input type="text" required placeholder="Ex: João Silva" value={nome} onChange={e => setNome(e.target.value)} disabled={saving} />
                </Field>

                <Field label="E-mail institucional">
                  <Input
                    type="email" required placeholder="joao@empresa.com"
                    value={email} onChange={e => setEmail(e.target.value)}
                    disabled={saving || !!editTarget}
                  />
                  {editTarget && (
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      E-mail não pode ser alterado após o cadastro.
                    </p>
                  )}
                </Field>

                <Field label="Função / Cargo (opcional)">
                  <Select value={funcao} onChange={e => { setFuncao(e.target.value); if (e.target.value !== '__custom__') setCustomFuncao(''); }} disabled={saving}>
                    <option value="">Sem função definida</option>
                    {FUNCOES_COMUNS.map(f => <option key={f} value={f}>{f}</option>)}
                    <option value="__custom__">Outra (personalizada)</option>
                  </Select>
                  {funcao === '__custom__' && (
                    <Input type="text" placeholder="Ex: Analista de Mídia" value={customFuncao} onChange={e => setCustomFuncao(e.target.value)} style={{ marginTop: 6 }} disabled={saving} />
                  )}
                </Field>

                <Field
                  label="Valor/hora padrão (R$)"
                  hint="Usado quando o colaborador não tem uma tarifa específica para a categoria do projeto."
                >
                  <Input
                    type="number" required min="0.01" step="0.01" placeholder="Ex: 120.00"
                    value={valorHora} onChange={e => setValorHora(e.target.value)}
                    disabled={saving}
                  />
                </Field>

                {categorias.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                      Tarifas por categoria (opcional)
                    </label>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      Deixe em branco para usar o valor padrão. Preencha só as categorias com valor diferente.
                    </p>

                    {tarifasLoading ? (
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>Carregando tarifas…</p>
                    ) : tarifasFetchErro ? (
                      <p className="text-xs" style={{ color: '#b42318' }}>
                        Não foi possível carregar as tarifas; salvar não vai alterá-las.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {categorias.map(cat => (
                          <div key={cat.id} className="flex items-center gap-3">
                            <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--text-1)' }}>
                              {cat.nome}
                            </span>
                            <Input
                              type="number" min="0.01" step="0.01"
                              placeholder={placeholderPadrao()}
                              value={overrides[cat.id] ?? ''}
                              onChange={e => setOverrides(prev => ({ ...prev, [cat.id]: e.target.value }))}
                              disabled={saving}
                              style={{ width: 140 }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={closeModal} disabled={saving} className="flex-1 py-2 px-4 rounded-xl text-sm font-medium" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    Cancelar
                  </button>
                  <button type="submit" disabled={saving || tarifasLoading} className="flex-1 py-2 px-4 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--brand-500)', opacity: (saving || tarifasLoading) ? 0.7 : 1 }}>
                    {saving ? 'Verificando…' : tarifasLoading ? 'Carregando tarifas…' : editTarget ? 'Salvar' : 'Continuar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
