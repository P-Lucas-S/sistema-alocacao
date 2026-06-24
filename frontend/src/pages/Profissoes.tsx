import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { IdCard, Plus, Pencil, Power, PowerOff, X, AlertTriangle } from 'lucide-react';

interface Profissao {
  id: string;
  nome: string;
  ativo: boolean;
}

interface Similar {
  id: string;
  nome: string;
  ativo: boolean;
}

// Dados prontos para reenvio com confirmarSimilar: true
interface CriarPending {
  nome: string;
  similares: Similar[];
}

interface EditPending {
  id: string;
  nome: string;
  similares: Similar[];
}

const errorBoxStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 14px',
  background: 'hsl(0 85% 60% / 0.08)',
  border: '1px solid hsl(0 85% 60% / 0.25)',
  borderRadius: 10, fontSize: 13, color: '#b42318',
};

export default function Profissoes() {
  const { token } = useAuth();
  const [profissoes, setProfissoes] = useState<Profissao[]>([]);
  const [loading, setLoading] = useState(true);

  // Criar
  const [novoNome, setNovoNome]   = useState('');
  const [criando, setCriando]     = useState(false);
  const [criarErro, setCriarErro] = useState('');
  const [criarPending, setCriarPending] = useState<CriarPending | null>(null);

  // Renomear (linha em edição)
  const [editId, setEditId]       = useState<string | null>(null);
  const [editNome, setEditNome]   = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editErro, setEditErro]   = useState('');
  const [editPending, setEditPending] = useState<EditPending | null>(null);

  // Ativar/desativar
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchProfissoes = useCallback(async () => {
    try {
      const res = await fetch('/api/profissoes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setProfissoes(await res.json());
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchProfissoes(); }, [fetchProfissoes]);

  // ── Criar — estágio 1 ────────────────────────────────────────────────────
  async function handleCriar(e: React.FormEvent) {
    e.preventDefault();
    if (!novoNome.trim()) return;
    setCriarErro('');
    setCriando(true);
    try {
      const res = await fetch('/api/profissoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome: novoNome.trim() }),
      });
      const data = await res.json();

      // needsConfirmation vem com status 200 — checar ANTES de res.ok
      if (data.needsConfirmation) {
        setCriarPending({ nome: novoNome.trim(), similares: data.similares });
        return;
      }

      if (!res.ok) { setCriarErro(data.error || 'Erro ao criar profissão'); return; }

      // 201 — criada (objeto vem em data.profissao)
      setNovoNome('');
      fetchProfissoes();
    } catch {
      setCriarErro('Erro de rede');
    } finally {
      setCriando(false);
    }
  }

  // ── Criar — estágio 2: confirma mesmo com nome parecido ──────────────────
  async function handleCriarConfirmar() {
    if (!criarPending) return;
    setCriando(true);
    setCriarErro('');
    try {
      const res = await fetch('/api/profissoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome: criarPending.nome, confirmarSimilar: true }),
      });
      const data = await res.json();
      if (!res.ok) { setCriarErro(data.error || 'Erro ao criar profissão'); setCriarPending(null); return; }

      setCriarPending(null);
      setNovoNome('');
      fetchProfissoes();
    } catch {
      setCriarErro('Erro de rede');
    } finally {
      setCriando(false);
    }
  }

  function cancelarCriarConfirmacao() {
    setCriarPending(null);
    setCriarErro('');
  }

  // ── Renomear — helpers de edição inline ──────────────────────────────────
  function startEdit(p: Profissao) {
    setEditId(p.id);
    setEditNome(p.nome);
    setEditErro('');
    setEditPending(null);
  }

  function cancelEdit() {
    setEditId(null);
    setEditNome('');
    setEditErro('');
    setEditPending(null);
  }

  // ── Renomear — estágio 1 ─────────────────────────────────────────────────
  async function handleRenomear(id: string) {
    if (!editNome.trim()) return;
    setEditErro('');
    setEditSaving(true);
    try {
      const res = await fetch(`/api/profissoes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome: editNome.trim() }),
      });
      const data = await res.json();

      if (data.needsConfirmation) {
        setEditPending({ id, nome: editNome.trim(), similares: data.similares });
        return;
      }

      if (!res.ok) { setEditErro(data.error || 'Erro ao renomear'); return; }

      // sucesso — objeto vem DIRETO (não dentro de { profissao })
      setEditId(null);
      setEditNome('');
      fetchProfissoes();
    } catch {
      setEditErro('Erro de rede');
    } finally {
      setEditSaving(false);
    }
  }

  // ── Renomear — estágio 2: confirma mesmo com nome parecido ───────────────
  async function handleRenomearConfirmar() {
    if (!editPending) return;
    setEditSaving(true);
    setEditErro('');
    try {
      const res = await fetch(`/api/profissoes/${editPending.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome: editPending.nome, confirmarSimilar: true }),
      });
      const data = await res.json();
      if (!res.ok) { setEditErro(data.error || 'Erro ao renomear'); setEditPending(null); return; }

      setEditPending(null);
      setEditId(null);
      setEditNome('');
      fetchProfissoes();
    } catch {
      setEditErro('Erro de rede');
    } finally {
      setEditSaving(false);
    }
  }

  function cancelarEditConfirmacao() {
    setEditPending(null);
    setEditErro('');
  }

  // ── Ativar/Desativar ──────────────────────────────────────────────────────
  async function toggleAtivo(p: Profissao) {
    setTogglingId(p.id);
    try {
      await fetch(`/api/profissoes/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ativo: !p.ativo }),
      });
      fetchProfissoes();
    } catch { /* silently fail */ } finally {
      setTogglingId(null);
    }
  }

  const ghostBtnStyle: React.CSSProperties = {
    color: 'var(--text-3)', border: '1px solid var(--border)',
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6 h-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <IdCard size={20} style={{ color: 'var(--brand-500)' }} />
          Profissões
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
          Gerencie as profissões disponíveis para os colaboradores.
        </p>
      </div>

      {/* Adicionar profissão */}
      <div className="card p-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
          Adicionar profissão
        </h2>
        <form onSubmit={handleCriar} className="flex gap-3">
          <input
            type="text"
            className="form-input"
            placeholder="Nome da profissão"
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            disabled={criando}
          />
          <button
            type="submit"
            className="btn-brand"
            disabled={criando || !novoNome.trim()}
            style={{ flexShrink: 0 }}
          >
            <Plus size={15} />
            {criando ? 'Verificando…' : 'Adicionar'}
          </button>
        </form>

        {criarErro && <div style={errorBoxStyle}>{criarErro}</div>}

        {criarPending && (
          <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'hsl(38 92% 50% / 0.1)', border: '1px solid hsl(38 92% 50% / 0.3)' }}>
            <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: '#b45309' }} />
            <div className="flex-1">
              <p className="text-sm" style={{ color: '#b45309' }}>
                Já existe uma profissão parecida: <strong>{criarPending.similares.map(s => s.nome).join(', ')}</strong>. Cadastrar mesmo assim?
              </p>
              <div className="flex gap-3 mt-3">
                <button
                  onClick={cancelarCriarConfirmacao}
                  disabled={criando}
                  className="flex-1 py-2 px-4 rounded-xl text-sm font-medium"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCriarConfirmar}
                  disabled={criando}
                  className="btn-brand flex-1"
                  style={{ opacity: criando ? 0.7 : 1 }}
                >
                  {criando ? 'Cadastrando…' : 'Cadastrar mesmo assim'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Carregando…
        </div>
      ) : profissoes.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2" style={{ color: 'var(--text-3)' }}>
          <IdCard size={40} strokeWidth={1} />
          <p className="text-sm">Nenhuma profissão cadastrada.</p>
        </div>
      ) : (
        <div className="card">
          {profissoes.map((p, i) => (
            <div
              key={p.id}
              className="p-4 flex flex-col gap-3"
              style={{
                borderBottom: i < profissoes.length - 1 ? '1px solid var(--border)' : 'none',
                opacity: p.ativo ? 1 : 0.6,
              }}
            >
              {editId === p.id ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      className="form-input"
                      value={editNome}
                      onChange={e => setEditNome(e.target.value)}
                      disabled={editSaving}
                      autoFocus
                    />
                    <button
                      onClick={() => handleRenomear(p.id)}
                      className="btn-brand"
                      disabled={editSaving || !editNome.trim()}
                      style={{ flexShrink: 0 }}
                    >
                      {editSaving ? 'Salvando…' : 'Salvar'}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={editSaving}
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={ghostBtnStyle}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {editErro && <div style={errorBoxStyle}>{editErro}</div>}

                  {editPending && editPending.id === p.id && (
                    <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'hsl(38 92% 50% / 0.1)', border: '1px solid hsl(38 92% 50% / 0.3)' }}>
                      <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: '#b45309' }} />
                      <div className="flex-1">
                        <p className="text-sm" style={{ color: '#b45309' }}>
                          Já existe uma profissão parecida: <strong>{editPending.similares.map(s => s.nome).join(', ')}</strong>. Renomear mesmo assim?
                        </p>
                        <div className="flex gap-3 mt-3">
                          <button
                            onClick={cancelarEditConfirmacao}
                            disabled={editSaving}
                            className="flex-1 py-2 px-4 rounded-xl text-sm font-medium"
                            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleRenomearConfirmar}
                            disabled={editSaving}
                            className="btn-brand flex-1"
                            style={{ opacity: editSaving ? 0.7 : 1 }}
                          >
                            {editSaving ? 'Renomeando…' : 'Renomear mesmo assim'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>
                      {p.nome}
                    </span>
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                      style={p.ativo
                        ? { background: 'hsl(142 76% 36% / 0.12)', color: '#15803d' }
                        : { background: 'hsl(0 0% 50% / 0.12)', color: 'var(--text-3)' }}
                    >
                      {p.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => startEdit(p)}
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg"
                      style={ghostBtnStyle}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <Pencil size={11} /> Renomear
                    </button>
                    <button
                      onClick={() => toggleAtivo(p)}
                      disabled={togglingId === p.id}
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg"
                      style={ghostBtnStyle}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = p.ativo ? '#b42318' : '#15803d'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      {p.ativo ? <><PowerOff size={11} /> Desativar</> : <><Power size={11} /> Ativar</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
