import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, FolderPlus, Calendar, Archive, ArchiveRestore, Pencil, X, Plus, AlertTriangle, Layers } from 'lucide-react';

interface PrestacaoContas {
  id: string;
  data: string; // ISO — sempre midnight UTC: "2026-12-31T00:00:00.000Z"
}

interface ProximaPrestacao {
  data: string;
  vencida: boolean;
}

interface Projeto {
  id: string;
  codigo: string;
  nome: string;
  gestorId: string;
  status: string;
  createdAt: string;
  gestor: { id: string; name: string };
  prestacoesContas: PrestacaoContas[];
  proximaPrestacao: ProximaPrestacao | null;
}

// timeZone:'UTC' garante que "2026-12-31T00:00:00.000Z" mostre "31/12/2026", não "30/12/2026"
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// Extrai "YYYY-MM-DD" de um ISO string para usar em <input type="date">
function toInputDate(iso: string) {
  return iso.slice(0, 10);
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none', width: '100%',
};

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} style={{ ...inputStyle, ...props.style }} />
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

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  ativo:     { label: 'Ativo',     bg: 'hsl(142 71% 45% / 0.12)', color: '#4ade80' },
  arquivado: { label: 'Arquivado', bg: 'hsl(0 0% 50% / 0.12)',     color: 'var(--text-3)' },
};

export default function Projetos() {
  const { token, user } = useAuth();
  const [projetos, setProjetos]         = useState<Projeto[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filterStatus, setFilterStatus] = useState<'ativo' | 'arquivado' | 'todos'>('ativo');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editTarget, setEditTarget]   = useState<Projeto | null>(null);

  // Form state
  const [codigo, setCodigo] = useState('');
  const [nome, setNome]     = useState('');
  const [datas, setDatas]   = useState<string[]>([]);  // "YYYY-MM-DD"
  const [novaData, setNovaData] = useState('');
  const [datasError, setDatasError] = useState('');

  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  const navigate   = useNavigate();
  const canWrite   = user?.role === 'admin' || user?.role === 'gestor';
  const showGestor = user?.role === 'admin' || user?.role === 'coordenacao';

  const canEditProject = (p: Projeto) =>
    user?.role === 'admin' || (user?.role === 'gestor' && p.gestorId === user.id);

  const fetchProjetos = useCallback(async () => {
    try {
      const res = await fetch(`/api/projetos?status=${filterStatus}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setProjetos(await res.json());
    } finally { setLoading(false); }
  }, [token, filterStatus]);

  useEffect(() => { setLoading(true); fetchProjetos(); }, [fetchProjetos]);

  // ── Datas helpers ──────────────────────────────────────────────────────

  function addData() {
    if (!novaData) return;
    if (datas.includes(novaData)) {
      setDatasError('Esta data já foi adicionada.');
      return;
    }
    setDatas(prev => [...prev, novaData].sort());
    setNovaData('');
    setDatasError('');
  }

  function removeData(d: string) {
    setDatas(prev => prev.filter(x => x !== d));
  }

  // ── Modal helpers ──────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null);
    setCodigo(''); setNome(''); setDatas([]); setNovaData('');
    setError(''); setDatasError('');
    setIsModalOpen(true);
  }

  function openEdit(p: Projeto) {
    if (!canEditProject(p)) return;
    setEditTarget(p);
    setCodigo(p.codigo);
    setNome(p.nome);
    setDatas(p.prestacoesContas.map(pc => toInputDate(pc.data)).sort());
    setNovaData('');
    setError(''); setDatasError('');
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditTarget(null);
    setError(''); setDatasError('');
  }

  // ── Save ──────────────────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (datas.length === 0) {
      setDatasError('Adicione pelo menos uma data de prestação de contas.');
      return;
    }
    setError(''); setDatasError(''); setSaving(true);
    try {
      const body = editTarget
        ? { nome: nome.trim(), prestacoesContas: datas }
        : { codigo: codigo.trim(), nome: nome.trim(), prestacoesContas: datas };

      const res = await fetch(editTarget ? `/api/projetos/${editTarget.id}` : '/api/projetos', {
        method: editTarget ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao salvar'); return; }
      closeModal();
      fetchProjetos();
    } catch { setError('Erro de rede'); }
    finally { setSaving(false); }
  }

  async function handleToggleStatus(p: Projeto) {
    try {
      await fetch(`/api/projetos/${p.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: p.status === 'ativo' ? 'arquivado' : 'ativo' }),
      });
      fetchProjetos();
    } catch { /* silently fail */ }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col gap-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <FolderOpen size={20} style={{ color: 'var(--brand-500)' }} />
            Projetos
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
            {loading ? '…' : `${projetos.length} projeto${projetos.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--brand-500)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.9'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          >
            <FolderPlus size={15} /> Novo Projeto
          </button>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 shrink-0">
        {(['ativo', 'arquivado', 'todos'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
            style={{
              background: filterStatus === s ? 'var(--brand-500)' : 'var(--surface-2)',
              color: filterStatus === s ? '#fff' : 'var(--text-2)',
              border: `1px solid ${filterStatus === s ? 'var(--brand-500)' : 'var(--border)'}`,
            }}
          >
            {s === 'ativo' ? 'Ativos' : s === 'arquivado' ? 'Arquivados' : 'Todos'}
          </button>
        ))}
      </div>

      {/* Project cards */}
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Carregando…
        </div>
      ) : projetos.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2" style={{ color: 'var(--text-3)' }}>
          <FolderOpen size={40} strokeWidth={1} />
          <p className="text-sm">{filterStatus === 'arquivado' ? 'Nenhum projeto arquivado.' : 'Nenhum projeto ativo.'}</p>
          {canWrite && filterStatus === 'ativo' && (
            <button onClick={openCreate} className="text-sm font-medium mt-1" style={{ color: 'var(--brand-500)' }}>
              + Criar primeiro projeto
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {projetos.map(p => {
            const ss      = STATUS_STYLE[p.status] ?? STATUS_STYLE.ativo;
            const proxima = p.proximaPrestacao;
            const outras  = p.prestacoesContas.length - 1;
            const canAct  = canEditProject(p);

            return (
              <div
                key={p.id}
                className="rounded-2xl p-4 flex flex-col gap-3"
                style={{
                  background: 'var(--surface-1)', border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-sm)', opacity: p.status === 'arquivado' ? 0.6 : 1,
                }}
              >
                {/* Código + status */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-lg font-mono tracking-wider"
                    style={{ background: 'var(--brand-500)20', color: 'var(--brand-500)', border: '1px solid var(--brand-500)30' }}
                  >
                    {p.codigo}
                  </span>
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: ss.bg, color: ss.color }}
                  >
                    {ss.label}
                  </span>
                </div>

                {/* Nome */}
                <div>
                  <p className="font-semibold text-sm leading-snug" style={{ color: 'var(--text-1)' }}>{p.nome}</p>
                  {showGestor && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Gestor: {p.gestor.name}</p>
                  )}
                </div>

                {/* Próxima prestação (destaque) */}
                {proxima ? (
                  <div className="flex items-start gap-2">
                    <Calendar
                      size={13}
                      className="mt-0.5 shrink-0"
                      style={{ color: proxima.vencida ? '#f87171' : 'var(--text-3)' }}
                    />
                    <div>
                      <p
                        className="text-xs font-semibold"
                        style={{ color: proxima.vencida ? '#f87171' : 'var(--text-1)' }}
                      >
                        {proxima.vencida ? 'Todas vencidas — ' : 'Próxima prestação: '}
                        <span style={{ fontWeight: proxima.vencida ? 400 : 700 }}>
                          {fmtDate(proxima.data)}
                        </span>
                        {proxima.vencida && (
                          <span className="ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'hsl(0 85% 60% / 0.12)', color: '#f87171' }}>
                            vencida
                          </span>
                        )}
                      </p>
                      {outras > 0 && (
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          +{outras} outra{outras !== 1 ? 's' : ''} data{outras !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                    <AlertTriangle size={13} />
                    <p className="text-xs">Sem data de prestação de contas</p>
                  </div>
                )}

                {/* Actions */}
                {(canAct || true) && (
                  <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                    <button
                      onClick={() => navigate(`/projetos/${p.id}`)}
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg"
                      style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <Layers size={11} /> Ver entregas
                    </button>
                    {canAct && p.status === 'ativo' && (
                      <button
                        onClick={() => openEdit(p)}
                        className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg"
                        style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <Pencil size={11} /> Editar
                      </button>
                    )}
                    {canAct && <button
                      onClick={() => handleToggleStatus(p)}
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg ml-auto"
                      style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = p.status === 'ativo' ? '#f87171' : '#4ade80'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      {p.status === 'ativo'
                        ? <><Archive size={11} /> Arquivar</>
                        : <><ArchiveRestore size={11} /> Reativar</>}
                    </button>}
                  </div>
                )}
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
            className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>
                  {editTarget ? 'Editar Projeto' : 'Novo Projeto'}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {editTarget ? `Código ${editTarget.codigo} — não pode ser alterado` : 'Você será o gestor dono deste projeto.'}
                </p>
              </div>
              <button onClick={closeModal} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ color: 'var(--text-3)' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <X size={16} />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl text-sm shrink-0" style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 65%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="flex flex-col gap-4">
              {/* Código */}
              <Field label="Código" hint={editTarget ? 'Código imutável após criação.' : 'Único no sistema. Ex: PROJ-2026-001'}>
                <Input
                  type="text" required
                  placeholder="PROJ-2026-001"
                  value={codigo}
                  onChange={e => setCodigo(e.target.value.toUpperCase())}
                  disabled={saving || !!editTarget}
                  style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
                />
              </Field>

              {/* Nome */}
              <Field label="Nome do Projeto">
                <Input type="text" required placeholder="Ex: Campanha Verão 2026" value={nome} onChange={e => setNome(e.target.value)} disabled={saving} />
              </Field>

              {/* Datas de prestação — multi */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  Datas de Prestação de Contas
                  <span className="ml-1 font-normal normal-case tracking-normal" style={{ color: '#f87171' }}>
                    {datas.length === 0 ? '(obrigatório — ao menos 1)' : `(${datas.length} data${datas.length !== 1 ? 's' : ''})`}
                  </span>
                </label>

                {/* Input + adicionar */}
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={novaData}
                    onChange={e => { setNovaData(e.target.value); setDatasError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addData(); } }}
                    disabled={saving}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={addData}
                    disabled={!novaData || saving}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-all shrink-0"
                    style={{ background: 'var(--brand-500)', opacity: !novaData ? 0.5 : 1 }}
                  >
                    <Plus size={13} /> Adicionar
                  </button>
                </div>

                {/* Erro de data */}
                {datasError && (
                  <p className="text-xs" style={{ color: '#f87171' }}>{datasError}</p>
                )}

                {/* Lista de datas adicionadas */}
                {datas.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {datas.map(d => (
                      <div
                        key={d}
                        className="flex items-center justify-between px-3 py-2 rounded-lg"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                      >
                        <div className="flex items-center gap-2">
                          <Calendar size={12} style={{ color: 'var(--brand-500)' }} />
                          <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                            {/* exibe a data como digitada, sem conversão de fuso */}
                            {new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeData(d)}
                          disabled={saving}
                          className="w-5 h-5 rounded flex items-center justify-center"
                          style={{ color: 'var(--text-3)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Botões */}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal} disabled={saving} className="flex-1 py-2 px-4 rounded-xl text-sm font-medium" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="flex-1 py-2 px-4 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--brand-500)', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Salvando…' : editTarget ? 'Salvar' : 'Criar Projeto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
