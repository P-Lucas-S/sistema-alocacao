import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, FolderOpen, Plus, ChevronDown, ChevronRight,
  Pencil, Trash2, X, Layers, GitBranch,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface ProximaPrestacao { data: string; vencida: boolean }
interface PrestacaoContas  { id: string; data: string }

interface Categoria { id: string; nome: string; ativo: boolean }

interface Projeto {
  id: string; codigo: string; nome: string;
  gestorId: string; status: string;
  gestor: { id: string; name: string };
  categoria: Categoria | null;
  prestacoesContas: PrestacaoContas[];
  proximaPrestacao: ProximaPrestacao | null;
}

interface MicroEntrega {
  id: string; nome: string; descricao: string | null; status: string;
}

interface MacroEntrega {
  id: string; nome: string; descricao: string | null; status: string;
  microEntregas: MicroEntrega[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none', width: '100%',
};
const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} style={{ ...inputStyle, ...props.style }} />
);
const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} rows={2} style={{ ...inputStyle, resize: 'vertical', ...props.style as any }} />
);
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</label>
    {children}
  </div>
);

// ── Component ────────────────────────────────────────────────────────────────

export default function ProjetoDetalhe() {
  const { id: projetoId } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [projeto, setProjeto]     = useState<Projeto | null>(null);
  const [macros, setMacros]       = useState<MacroEntrega[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  // Macro modal
  const [macroModal, setMacroModal] = useState<{
    open: boolean; editId: string | null; nome: string; descricao: string;
  }>({ open: false, editId: null, nome: '', descricao: '' });

  // Micro modal
  const [microModal, setMicroModal] = useState<{
    open: boolean; macroId: string; editId: string | null; nome: string; descricao: string;
  }>({ open: false, macroId: '', editId: null, nome: '', descricao: '' });

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const canWrite = user?.role === 'admin' ||
    (user?.role === 'gestor' && projeto?.gestorId === user.id);

  // ── Fetch ──────────────────────────────────────────────────────────────

  const fetchProjeto = useCallback(async () => {
    const res = await fetch(`/api/projetos/${projetoId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setProjeto(await res.json());
  }, [token, projetoId]);

  const fetchMacros = useCallback(async () => {
    const res = await fetch(`/api/projetos/${projetoId}/macros`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setMacros(await res.json());
  }, [token, projetoId]);

  useEffect(() => {
    Promise.all([fetchProjeto(), fetchMacros()]).finally(() => setLoading(false));
  }, [fetchProjeto, fetchMacros]);

  // ── Macro actions ─────────────────────────────────────────────────────

  function openCreateMacro() {
    setMacroModal({ open: true, editId: null, nome: '', descricao: '' });
    setFormError('');
  }

  function openEditMacro(m: MacroEntrega) {
    setMacroModal({ open: true, editId: m.id, nome: m.nome, descricao: m.descricao ?? '' });
    setFormError('');
  }

  async function saveMacro(e: React.FormEvent) {
    e.preventDefault();
    if (!macroModal.nome.trim()) { setFormError('Nome é obrigatório'); return; }
    setSaving(true); setFormError('');
    try {
      const url    = macroModal.editId
        ? `/api/projetos/${projetoId}/macros/${macroModal.editId}`
        : `/api/projetos/${projetoId}/macros`;
      const method = macroModal.editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome: macroModal.nome.trim(), descricao: macroModal.descricao.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || 'Erro ao salvar'); return; }

      setMacroModal(m => ({ ...m, open: false }));
      // Auto-expand nova macro
      if (!macroModal.editId) setExpanded(prev => new Set([...prev, data.id]));
      fetchMacros();
    } finally { setSaving(false); }
  }

  async function deleteMacro(macroId: string) {
    if (!confirm('Apagar esta macro e todas as suas micro-entregas?')) return;
    const res = await fetch(`/api/projetos/${projetoId}/macros/${macroId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    fetchMacros();
  }

  // ── Micro actions ─────────────────────────────────────────────────────

  function openCreateMicro(macroId: string) {
    setMicroModal({ open: true, macroId, editId: null, nome: '', descricao: '' });
    setFormError('');
    setExpanded(prev => new Set([...prev, macroId]));
  }

  function openEditMicro(macroId: string, micro: MicroEntrega) {
    setMicroModal({ open: true, macroId, editId: micro.id, nome: micro.nome, descricao: micro.descricao ?? '' });
    setFormError('');
  }

  async function saveMicro(e: React.FormEvent) {
    e.preventDefault();
    if (!microModal.nome.trim()) { setFormError('Nome é obrigatório'); return; }
    setSaving(true); setFormError('');
    try {
      const url    = microModal.editId
        ? `/api/projetos/${projetoId}/macros/${microModal.macroId}/micros/${microModal.editId}`
        : `/api/projetos/${projetoId}/macros/${microModal.macroId}/micros`;
      const method = microModal.editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome: microModal.nome.trim(), descricao: microModal.descricao.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || 'Erro ao salvar'); return; }
      setMicroModal(m => ({ ...m, open: false }));
      fetchMacros();
    } finally { setSaving(false); }
  }

  async function deleteMicro(macroId: string, microId: string) {
    const res = await fetch(`/api/projetos/${projetoId}/macros/${macroId}/micros/${microId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    fetchMacros();
  }

  function toggleExpand(macroId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(macroId) ? next.delete(macroId) : next.add(macroId);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full gap-2" style={{ color: 'var(--text-3)' }}>
      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      Carregando…
    </div>
  );

  if (!projeto) return (
    <div className="p-6" style={{ color: 'var(--text-3)' }}>Projeto não encontrado.</div>
  );

  const proxima = projeto.proximaPrestacao;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl">
      {/* Breadcrumb + header */}
      <div>
        <button
          onClick={() => navigate('/projetos')}
          className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
          style={{ color: 'var(--text-3)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
        >
          <ArrowLeft size={13} /> Projetos
        </button>

        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--brand-500)15', border: '1px solid var(--brand-500)30' }}
          >
            <FolderOpen size={20} style={{ color: 'var(--brand-500)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs font-bold px-2 py-0.5 rounded font-mono"
                style={{ background: 'var(--brand-500)15', color: 'var(--brand-500)' }}
              >
                {projeto.codigo}
              </span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{
                  background: projeto.status === 'ativo' ? 'hsl(142 71% 45% / 0.12)' : 'hsl(0 0% 50% / 0.12)',
                  color: projeto.status === 'ativo' ? '#4ade80' : 'var(--text-3)',
                }}
              >
                {projeto.status === 'ativo' ? 'Ativo' : 'Arquivado'}
              </span>
              {projeto.categoria && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: 'var(--accent-500)15', color: 'var(--accent-600)' }}
                >
                  {projeto.categoria.nome}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{projeto.nome}</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              Gestor: {projeto.gestor.name}
              {proxima && (
                <span
                  className="ml-3"
                  style={{ color: proxima.vencida ? '#f87171' : 'var(--text-3)' }}
                >
                  · Próxima prestação: {fmtDate(proxima.data)}
                  {proxima.vencida ? ' (vencida)' : ''}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Macros section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
            <Layers size={15} />
            Macro-Entregas
            <span className="text-xs font-normal" style={{ color: 'var(--text-3)' }}>({macros.length})</span>
          </h2>
          {canWrite && (
            <button
              onClick={openCreateMacro}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'var(--brand-500)' }}
            >
              <Plus size={13} /> Adicionar Macro
            </button>
          )}
        </div>

        {macros.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-10 rounded-2xl gap-2"
            style={{ border: '1px dashed var(--border)', color: 'var(--text-3)' }}
          >
            <Layers size={32} strokeWidth={1} />
            <p className="text-sm">Nenhuma macro-entrega ainda.</p>
            {canWrite && (
              <button onClick={openCreateMacro} className="text-sm font-medium" style={{ color: 'var(--brand-500)' }}>
                + Criar primeira macro
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {macros.map(macro => {
              const isExpanded = expanded.has(macro.id);
              return (
                <div
                  key={macro.id}
                  className="rounded-2xl overflow-hidden"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
                >
                  {/* Macro header */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                    onClick={() => toggleExpand(macro.id)}
                  >
                    {isExpanded
                      ? <ChevronDown size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                      : <ChevronRight size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{macro.nome}</p>
                      {macro.descricao && (
                        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{macro.descricao}</p>
                      )}
                    </div>

                    <span className="text-xs shrink-0" style={{ color: 'var(--text-3)' }}>
                      {macro.microEntregas.length} micro{macro.microEntregas.length !== 1 ? 's' : ''}
                    </span>

                    {canWrite && (
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => openEditMacro(macro)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ color: 'var(--text-3)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                          title="Editar macro"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => deleteMacro(macro.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ color: 'var(--text-3)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                          title="Apagar macro e suas micros"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Micro list */}
                  {isExpanded && (
                    <div className="border-t px-4 pb-3 pt-2 flex flex-col gap-1.5" style={{ borderColor: 'var(--border)' }}>
                      {macro.microEntregas.map(micro => {
                        const isGeral = micro.nome === 'Geral';
                        const isOnly  = macro.microEntregas.length === 1;
                        return (
                          <div
                            key={micro.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ background: 'var(--surface-2)' }}
                          >
                            <GitBranch size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                            <span className="text-sm flex-1" style={{ color: 'var(--text-1)' }}>{micro.nome}</span>
                            {isGeral && (
                              <span
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                                style={{ background: 'var(--brand-500)15', color: 'var(--brand-500)' }}
                              >
                                padrão
                              </span>
                            )}
                            {canWrite && (
                              <>
                                <button
                                  onClick={() => openEditMicro(macro.id, micro)}
                                  className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                                  style={{ color: 'var(--text-3)' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                                  title="Editar micro-entrega"
                                >
                                  <Pencil size={11} />
                                </button>
                                <button
                                  onClick={() => deleteMicro(macro.id, micro.id)}
                                  disabled={isOnly}
                                  className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                                  style={{ color: isOnly ? 'var(--border)' : 'var(--text-3)', cursor: isOnly ? 'not-allowed' : 'pointer' }}
                                  onMouseEnter={e => { if (!isOnly) (e.currentTarget as HTMLElement).style.color = '#f87171'; }}
                                  onMouseLeave={e => { if (!isOnly) (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
                                  title={isOnly ? 'Única micro — não pode ser removida' : 'Remover micro-entrega'}
                                >
                                  <X size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}

                      {canWrite && (
                        <button
                          onClick={() => openCreateMicro(macro.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium mt-1 self-start"
                          style={{ color: 'var(--brand-500)', border: '1px dashed var(--brand-500)40' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--brand-500)08'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                        >
                          <Plus size={11} /> Adicionar micro-entrega
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal macro ─────────────────────────────────────────────────── */}
      {macroModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'hsl(0 0% 0% / 0.5)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setMacroModal(m => ({ ...m, open: false })); }}>
          <div className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>
                {macroModal.editId ? 'Editar Macro-Entrega' : 'Nova Macro-Entrega'}
              </h2>
              <button onClick={() => setMacroModal(m => ({ ...m, open: false }))} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: 'var(--text-3)' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <X size={16} />
              </button>
            </div>
            {!macroModal.editId && (
              <p className="text-xs -mt-2" style={{ color: 'var(--text-3)' }}>
                Uma micro-entrega "Geral" será criada automaticamente como destino padrão.
              </p>
            )}
            {formError && <div className="p-3 rounded-xl text-sm" style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 65%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>{formError}</div>}
            <form onSubmit={saveMacro} className="flex flex-col gap-4">
              <Field label="Nome">
                <Input type="text" required placeholder="Ex: Design e Identidade Visual" value={macroModal.nome} onChange={e => setMacroModal(m => ({ ...m, nome: e.target.value }))} disabled={saving} autoFocus />
              </Field>
              <Field label="Descrição (opcional)">
                <Textarea placeholder="Detalhe o escopo desta macro…" value={macroModal.descricao} onChange={e => setMacroModal(m => ({ ...m, descricao: e.target.value }))} disabled={saving} />
              </Field>
              <div className="flex gap-3">
                <button type="button" onClick={() => setMacroModal(m => ({ ...m, open: false }))} disabled={saving} className="flex-1 py-2 rounded-xl text-sm font-medium" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--brand-500)', opacity: saving ? 0.7 : 1 }}>{saving ? 'Salvando…' : macroModal.editId ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal micro ─────────────────────────────────────────────────── */}
      {microModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'hsl(0 0% 0% / 0.5)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setMicroModal(m => ({ ...m, open: false })); }}>
          <div className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>
                {microModal.editId ? 'Editar Micro-Entrega' : 'Nova Micro-Entrega'}
              </h2>
              <button onClick={() => setMicroModal(m => ({ ...m, open: false }))} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: 'var(--text-3)' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <X size={16} />
              </button>
            </div>
            {formError && <div className="p-3 rounded-xl text-sm" style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 65%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>{formError}</div>}
            <form onSubmit={saveMicro} className="flex flex-col gap-4">
              <Field label="Nome">
                <Input type="text" required placeholder="Ex: Criação de Logotipo" value={microModal.nome} onChange={e => setMicroModal(m => ({ ...m, nome: e.target.value }))} disabled={saving} autoFocus />
              </Field>
              <Field label="Descrição (opcional)">
                <Textarea placeholder="Detalhe a entrega específica…" value={microModal.descricao} onChange={e => setMicroModal(m => ({ ...m, descricao: e.target.value }))} disabled={saving} />
              </Field>
              <div className="flex gap-3">
                <button type="button" onClick={() => setMicroModal(m => ({ ...m, open: false }))} disabled={saving} className="flex-1 py-2 rounded-xl text-sm font-medium" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--brand-500)', opacity: saving ? 0.7 : 1 }}>{saving ? 'Salvando…' : microModal.editId ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
