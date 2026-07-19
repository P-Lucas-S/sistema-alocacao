import React, { useState, useEffect, useCallback } from 'react';
import { NumericFormat } from 'react-number-format';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, FolderOpen, Plus, ChevronDown, ChevronRight,
  Pencil, Trash2, X, Layers, GitBranch, BarChart2, AlertTriangle, Info, Brain,
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
  valorTotal: string | null;
  valorOficial: string | null;
  estrategiaOficial: string;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
}

interface MicroEntrega {
  id: string; nome: string; descricao: string | null; status: string;
}

interface MacroEntrega {
  id: string; nome: string; descricao: string | null; status: string;
  microEntregas: MicroEntrega[];
}

interface MetaMes {
  ano: number; mes: number;
  medicao: string; oficialAlocado: string; metaHT: string;
  pinado: boolean; pinadaMedicao: boolean; fechado: boolean;
  receitaPlanejada: string; deficit: string;
  avisoPiso?: string;
}
interface MetaResumo {
  valorTotal: string; valorOficial: string; valorHT: string; somaMetaHT: string;
  totalCortadoPeloPiso: string;
  cascataPendente: boolean; numeroMeses: number; estrategiaOficial: string;
  avisoEstouroMedicao?: string;
  saldoNaoPlanejado?: string;
  precisaDecisaoManual?: { faltam: string; folgaPorMes: { ano: number; mes: number; folga: string }[] };
}
type MetaData =
  | { configurado: false }
  | { configurado: true; resumo: MetaResumo; meses: MetaMes[] };

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function fmtMoeda(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function fmtMes(ano: number, mes: number): string {
  return `${MESES_ABR[mes - 1]}/${String(ano).slice(2)}`;
}

const thMeta: React.CSSProperties = {
  padding: '8px 12px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
  textAlign: 'left', whiteSpace: 'nowrap',
};
const tdMeta: React.CSSProperties = {
  padding: '8px 12px', fontSize: 13, color: 'var(--text-1)',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
};

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

  const [projeto, setProjeto]         = useState<Projeto | null>(null);
  const [macros, setMacros]           = useState<MacroEntrega[]>([]);
  const [metaData, setMetaData]       = useState<MetaData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());
  const [estrategiaSaving, setEstrategiaSaving] = useState(false);

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

  const [editingMeta, setEditingMeta] = useState<{ ano: number; mes: number; valor: number | null } | null>(null);
  const [savingPino, setSavingPino] = useState(false);
  const [editingMedicao, setEditingMedicao] = useState<{ ano: number; mes: number; valor: number | null } | null>(null);
  const [savingPinoMedicao, setSavingPinoMedicao] = useState(false);

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

  const fetchMeta = useCallback(async () => {
    const res = await fetch(`/api/projetos/${projetoId}/meta-apropriacao`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setMetaData(await res.json());
  }, [token, projetoId]);

  useEffect(() => {
    Promise.all([fetchProjeto(), fetchMacros(), fetchMeta()]).finally(() => setLoading(false));
  }, [fetchProjeto, fetchMacros, fetchMeta]);

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
    const res = await fetch(`/api/projetos/${projetoId}/macros/${macroId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok) { alert(data.error); return; }

    // needsConfirmation sempre vem na 1ª chamada (mesmo macro vazia) — um único confirm()
    if (data.needsConfirmation) {
      const mensagem = data.totalAlocacoes > 0
        ? `Esta macro tem ${data.totalAlocacoes} alocação(ões) (${Number(data.totalHoras)}h planejadas). Apagar remove todas elas e não pode ser desfeito. Continuar?`
        : `Apagar esta macro?`;

      if (!confirm(mensagem)) return;

      const res2 = await fetch(`/api/projetos/${projetoId}/macros/${macroId}?confirmar=true`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      const data2 = await res2.json();
      if (!res2.ok) { alert(data2.error); return; }
      fetchMacros();
      if (data2.alocacoesRemovidas > 0) alert(`${data2.alocacoesRemovidas} alocações removidas`);
      return;
    }
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

  async function handleEstrategiaChange(novaEstrategia: string) {
    if (!projeto) return;
    setEstrategiaSaving(true);
    try {
      const res = await fetch(`/api/projetos/${projetoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          estrategiaOficial: novaEstrategia,
          valorTotal:     projeto.valorTotal,
          valorOficial:   projeto.valorOficial,
          vigenciaInicio: projeto.vigenciaInicio,
          vigenciaFim:    projeto.vigenciaFim,
        }),
      });
      if (res.ok) await Promise.all([fetchProjeto(), fetchMeta()]);
    } finally {
      setEstrategiaSaving(false);
    }
  }

  async function savePino(ano: number, mes: number, valor: number | null) {
    if (valor === null || valor < 0) { setEditingMeta(null); return; }
    setSavingPino(true);
    try {
      const res = await fetch(`/api/projetos/${projetoId}/meta-apropriacao/pino`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ano, mes, metaHT: valor }),
      });
      if (res.ok) await fetchMeta();
    } finally {
      setSavingPino(false);
      setEditingMeta(null);
    }
  }

  async function removePino(ano: number, mes: number) {
    const res = await fetch(`/api/projetos/${projetoId}/meta-apropriacao/pino/${ano}/${mes}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) await fetchMeta();
  }

  async function savePinoMedicao(ano: number, mes: number, valor: number | null) {
    if (valor === null || valor < 0) { setEditingMedicao(null); return; }
    setSavingPinoMedicao(true);
    try {
      const res = await fetch(`/api/projetos/${projetoId}/meta-apropriacao/pino-medicao`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ano, mes, medicao: valor }),
      });
      if (res.ok) await fetchMeta();
    } finally {
      setSavingPinoMedicao(false);
      setEditingMedicao(null);
    }
  }

  async function removePinoMedicao(ano: number, mes: number) {
    const res = await fetch(`/api/projetos/${projetoId}/meta-apropriacao/pino-medicao/${ano}/${mes}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) await fetchMeta();
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

  const valorTotalNum   = projeto.valorTotal   != null ? parseFloat(projeto.valorTotal)   : null;
  const valorOficialNum = projeto.valorOficial  != null ? parseFloat(projeto.valorOficial) : null;
  const valorHTNum      = valorTotalNum != null && valorOficialNum != null
    ? valorTotalNum - valorOficialNum
    : null;

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

      {/* ── Resumo Financeiro ────────────────────────────────────────────── */}
      <div
        className="rounded-2xl p-4 flex flex-col gap-3"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          Resumo Financeiro
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Valor Total', value: valorTotalNum },
            { label: 'Valor Oficial', value: valorOficialNum },
            { label: 'A Apropriar (HT)', value: valorHTNum, negative: valorHTNum !== null && valorHTNum < 0 },
          ].map(({ label, value, negative }) => (
            <div key={label}>
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
              {value != null
                ? <p className="text-base font-bold" style={{ color: negative ? '#f87171' : 'var(--text-1)' }}>{fmtMoeda(value)}</p>
                : <p className="text-sm" style={{ color: 'var(--text-3)' }}>—</p>
              }
            </div>
          ))}
        </div>
        {(projeto.vigenciaInicio || projeto.vigenciaFim) && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            Vigência: {projeto.vigenciaInicio ? fmtDate(projeto.vigenciaInicio) : '?'} → {projeto.vigenciaFim ? fmtDate(projeto.vigenciaFim) : '?'}
          </p>
        )}
      </div>

      {/* ── Meta de Apropriação ──────────────────────────────────────── */}
      <div
        className="rounded-2xl p-4 flex flex-col gap-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <BarChart2 size={13} />
          Meta de Apropriação
        </h2>

        {metaData == null ? (
          <div className="text-sm" style={{ color: 'var(--text-3)' }}>Carregando…</div>
        ) : !metaData.configurado ? (
          <div
            className="flex flex-col items-center justify-center py-8 gap-2 rounded-xl"
            style={{ border: '1px dashed var(--border)', color: 'var(--text-3)' }}
          >
            <BarChart2 size={28} strokeWidth={1} />
            <p className="text-sm text-center px-4">
              Configure a vigência e os valores do projeto para ver a meta de apropriação.
            </p>
          </div>
        ) : (
          <>
            {/* Seletor de estratégia */}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Distribuição do oficial
              </label>
              <select
                value={projeto.estrategiaOficial}
                disabled={!canWrite || estrategiaSaving}
                onChange={e => handleEstrategiaChange(e.target.value)}
                style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '5px 10px', color: 'var(--text-1)', fontSize: 13,
                  outline: 'none', opacity: estrategiaSaving ? 0.6 : 1,
                  cursor: canWrite && !estrategiaSaving ? 'pointer' : 'default',
                }}
              >
                <option value="proporcional">Distribuir proporcionalmente</option>
                <option value="inicial">Priorizar meses iniciais</option>
              </select>
              {estrategiaSaving && (
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>Salvando…</span>
              )}
            </div>

            {/* Mini-resumo */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
                  A Apropriar (HT)
                </p>
                <p className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
                  {fmtMoeda(metaData.resumo.valorHT)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
                  Soma Meta Mensal
                </p>
                <p className="text-base font-bold" style={{ color: metaData.resumo.cascataPendente ? '#f59e0b' : 'var(--text-1)' }}>
                  {fmtMoeda(metaData.resumo.somaMetaHT)}
                </p>
              </div>
            </div>
            {parseFloat(metaData.resumo.totalCortadoPeloPiso) > 0 && (
              <div
                className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs"
                style={{ background: 'hsl(38 92% 50% / 0.08)', color: 'hsl(38 92% 45%)', border: '1px solid hsl(38 92% 50% / 0.2)' }}
              >
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>
                  {fmtMoeda(metaData.resumo.totalCortadoPeloPiso)} de valor oficial não convertidos em Meta HT — a medição desses meses é menor que o oficial.
                </span>
              </div>
            )}

            {metaData.resumo.saldoNaoPlanejado && (
              <div
                className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs"
                style={{ background: 'hsl(220 80% 56% / 0.1)', color: 'hsl(220 80% 50%)', border: '1px solid hsl(220 80% 56% / 0.2)' }}
              >
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>
                  {fmtMoeda(metaData.resumo.saldoNaoPlanejado)} ficaram disponíveis após o ajuste. Todos os meses já atingiram a meta de apropriação.
                </span>
              </div>
            )}
            {metaData.resumo.precisaDecisaoManual && (
              <div
                className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs"
                style={{ background: 'hsl(38 92% 50% / 0.1)', color: 'hsl(38 92% 45%)', border: '1px solid hsl(38 92% 50% / 0.2)' }}
              >
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>
                  Não há saldo disponível nos demais meses para este aumento sem comprometer a cobertura financeira (faltam {fmtMoeda(metaData.resumo.precisaDecisaoManual.faltam)}).
                </span>
              </div>
            )}
            {metaData.resumo.cascataPendente && !metaData.resumo.saldoNaoPlanejado && !metaData.resumo.precisaDecisaoManual && (
              <div
                className="px-3 py-2 rounded-xl text-xs"
                style={{ background: 'hsl(38 92% 50% / 0.1)', color: 'hsl(38 92% 50%)', border: '1px solid hsl(38 92% 50% / 0.2)' }}
              >
                Cascata pendente — a soma dos meses não fecha com o valorHT. Ajuste os pinos.
              </div>
            )}
            {metaData.resumo.avisoEstouroMedicao && (
              <div
                className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs"
                style={{ background: 'hsl(0 84% 60% / 0.1)', color: '#f87171', border: '1px solid hsl(0 84% 60% / 0.2)' }}
              >
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>{metaData.resumo.avisoEstouroMedicao}</span>
              </div>
            )}

            {/* Tabela por mês */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thMeta}>Mês</th>
                    <th style={{ ...thMeta, textAlign: 'right' }}>Medição</th>
                    <th style={{ ...thMeta, textAlign: 'right' }}>Oficial</th>
                    <th style={{ ...thMeta, textAlign: 'right' }}>Meta HT</th>
                    <th style={{ ...thMeta, textAlign: 'right' }}>Rec. Planejada</th>
                    <th style={{ ...thMeta, textAlign: 'right' }}>Déficit</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const temPinos = metaData.meses.some(m => m.pinado);
                    return metaData.meses.map(m => {
                      const def = parseFloat(m.deficit);
                      const baseCents = Math.round(parseFloat(m.medicao) * 100) - Math.round(parseFloat(m.oficialAlocado) * 100);
                      const metaCents = Math.round(parseFloat(m.metaHT) * 100);
                      const ajustado  = !m.pinado && !m.fechado && temPinos && metaCents !== baseCents;
                      const isEditing = editingMeta?.ano === m.ano && editingMeta?.mes === m.mes;
                      const isEditingMedicao = editingMedicao?.ano === m.ano && editingMedicao?.mes === m.mes;
                      const anyPinoSaving = savingPino || savingPinoMedicao;
                      return (
                        <tr key={`${m.ano}-${m.mes}`}>
                          <td style={tdMeta}>
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{fmtMes(m.ano, m.mes)}</span>
                              {m.pinado && (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'color-mix(in srgb, var(--brand-500) 15%, transparent)', color: 'var(--brand-500)' }}
                                >
                                  pin meta
                                </span>
                              )}
                              {m.pinado && canWrite && (
                                <button
                                  onClick={() => removePino(m.ano, m.mes)}
                                  disabled={anyPinoSaving}
                                  title="Remover pino de meta"
                                  className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors"
                                  style={{ color: 'var(--text-3)' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                                >
                                  <X size={10} />
                                </button>
                              )}
                              {m.fechado && (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'hsl(0 0% 50% / 0.12)', color: 'var(--text-3)' }}
                                >
                                  fechado
                                </span>
                              )}
                              {ajustado && (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'hsl(38 92% 50% / 0.12)', color: 'hsl(38 92% 45%)' }}
                                >
                                  ajust.
                                </span>
                              )}
                            </div>
                          </td>
                          {/* Coluna Medição — editável, com pino de medição */}
                          <td
                            style={{ ...tdMeta, textAlign: 'right', fontWeight: m.pinadaMedicao ? 600 : undefined, padding: isEditingMedicao ? '4px 8px' : tdMeta.padding, cursor: (!m.fechado && canWrite && !isEditingMedicao && !isEditing && !anyPinoSaving) ? 'pointer' : undefined }}
                            onClick={() => {
                              if (!canWrite || m.fechado || isEditingMedicao || isEditing || anyPinoSaving) return;
                              setEditingMedicao({ ano: m.ano, mes: m.mes, valor: parseFloat(m.medicao) });
                            }}
                          >
                            {isEditingMedicao ? (
                              <NumericFormat
                                value={editingMedicao!.valor ?? ''}
                                thousandSeparator="."
                                decimalSeparator=","
                                decimalScale={2}
                                fixedDecimalScale
                                prefix="R$ "
                                allowNegative={false}
                                onValueChange={({ floatValue }) =>
                                  setEditingMedicao(e => e ? { ...e, valor: floatValue ?? null } : null)
                                }
                                onBlur={() => savePinoMedicao(m.ano, m.mes, editingMedicao!.valor)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.currentTarget.blur(); }
                                  if (e.key === 'Escape') { setEditingMedicao(null); }
                                }}
                                autoFocus
                                disabled={savingPinoMedicao}
                                style={{
                                  background: 'var(--surface-2)',
                                  border: '1px solid var(--brand-500)',
                                  borderRadius: 6,
                                  padding: '4px 8px',
                                  color: 'var(--text-1)',
                                  fontSize: 13,
                                  outline: 'none',
                                  width: 150,
                                  textAlign: 'right',
                                  fontWeight: 600,
                                }}
                              />
                            ) : (
                              <div className={`flex items-center justify-end gap-1.5${canWrite && !m.fechado ? ' group' : ''}`}>
                                {m.pinadaMedicao && canWrite && (
                                  <button
                                    onClick={e => { e.stopPropagation(); removePinoMedicao(m.ano, m.mes); }}
                                    disabled={anyPinoSaving}
                                    title="Remover pino de medição"
                                    className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors"
                                    style={{ color: 'var(--text-3)' }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                                  >
                                    <X size={10} />
                                  </button>
                                )}
                                {m.pinadaMedicao && (
                                  <span
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                    style={{ background: 'color-mix(in srgb, var(--brand-500) 15%, transparent)', color: 'var(--brand-500)' }}
                                  >
                                    pin med.
                                  </span>
                                )}
                                <span>{fmtMoeda(m.medicao)}</span>
                                {m.avisoPiso && (
                                  <span title={m.avisoPiso} style={{ lineHeight: 0 }}>
                                    <AlertTriangle size={11} style={{ color: 'hsl(38 92% 50%)' }} className="shrink-0" />
                                  </span>
                                )}
                                {canWrite && !m.fechado && (
                                  <Pencil size={10} className="opacity-0 group-hover:opacity-40 transition-opacity shrink-0" />
                                )}
                              </div>
                            )}
                          </td>
                          <td style={{ ...tdMeta, textAlign: 'right' }}>{fmtMoeda(m.oficialAlocado)}</td>
                          <td
                            style={{ ...tdMeta, textAlign: 'right', fontWeight: 600, padding: isEditing ? '4px 8px' : tdMeta.padding, cursor: (!m.fechado && canWrite && !isEditing && !anyPinoSaving) ? 'pointer' : undefined }}
                            onClick={() => {
                              if (!canWrite || m.fechado || isEditing || anyPinoSaving) return;
                              setEditingMeta({ ano: m.ano, mes: m.mes, valor: parseFloat(m.metaHT) });
                            }}
                          >
                            {isEditing ? (
                              <NumericFormat
                                value={editingMeta!.valor ?? ''}
                                thousandSeparator="."
                                decimalSeparator=","
                                decimalScale={2}
                                fixedDecimalScale
                                prefix="R$ "
                                allowNegative={false}
                                onValueChange={({ floatValue }) =>
                                  setEditingMeta(e => e ? { ...e, valor: floatValue ?? null } : null)
                                }
                                onBlur={() => savePino(m.ano, m.mes, editingMeta!.valor)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.currentTarget.blur(); }
                                  if (e.key === 'Escape') { setEditingMeta(null); }
                                }}
                                autoFocus
                                disabled={anyPinoSaving}
                                style={{
                                  background: 'var(--surface-2)',
                                  border: '1px solid var(--brand-500)',
                                  borderRadius: 6,
                                  padding: '4px 8px',
                                  color: 'var(--text-1)',
                                  fontSize: 13,
                                  outline: 'none',
                                  width: 150,
                                  textAlign: 'right',
                                  fontWeight: 600,
                                }}
                              />
                            ) : (
                              <div className={`flex items-center justify-end gap-1.5${canWrite && !m.fechado ? ' group' : ''}`}>
                                <span>{fmtMoeda(m.metaHT)}</span>
                                {canWrite && !m.fechado && (
                                  <Pencil size={10} className="opacity-0 group-hover:opacity-40 transition-opacity shrink-0" />
                                )}
                              </div>
                            )}
                          </td>
                          <td style={{ ...tdMeta, textAlign: 'right' }}>{fmtMoeda(m.receitaPlanejada)}</td>
                          <td style={{
                            ...tdMeta, textAlign: 'right',
                            fontWeight: def > 0 ? 600 : undefined,
                            color: def > 0 ? '#f87171' : 'var(--text-3)',
                          }}>
                            {def > 0 ? fmtMoeda(m.deficit) : '—'}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Planejar equipe — visível para admin/chefe/gestor-dono quando meta configurada */}
      {metaData?.configurado && (user?.role === 'admin' || user?.role === 'chefe' ||
        (user?.role === 'gestor' && projeto.gestorId === user.id)) && (
        <div className="flex">
          <button
            onClick={() => navigate(`/projetos/${projetoId}/planejar`)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--brand-500)' }}
          >
            <Brain size={15} />
            Planejar equipe
          </button>
        </div>
      )}

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
