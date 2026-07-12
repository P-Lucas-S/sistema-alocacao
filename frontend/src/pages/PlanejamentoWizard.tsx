import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Brain, BarChart2, Layers, ChevronDown, ChevronRight,
  AlertTriangle, Info, X, Zap, Check,
} from 'lucide-react';
import Combobox from '../components/Combobox';

// ── Types ────────────────────────────────────────────────────────────────────

interface Projeto {
  id: string; codigo: string; nome: string; gestorId: string;
  vigenciaInicio: string | null; vigenciaFim: string | null;
  valorTotal: string | null;
}
interface MacroEntrega { id: string; nome: string }
interface MetaMes {
  ano: number; mes: number;
  metaHT: string; receitaPlanejada: string; deficit: string;
  fechado: boolean; pinado: boolean;
}
type MetaData =
  | { configurado: false }
  | { configurado: true; meses: MetaMes[]; resumo: { valorHT: string } };

interface Profissao { id: string; nome: string }
interface Colab { id: string; nome: string; profissao: { id: string; nome: string } | null }

interface LinhaSugestao {
  colaboradorId: string; nome: string; profissao: string; mes: string;
  horas: number; tarifa: string; receita: string;
  camada: 'fixado' | 'equipe' | 'novo';
  disponibilidadeVista: number; disponibilidadeApos: number; explicacao: string;
}
interface TotalMes {
  mes: string; metaHT: string; receitaAtual: string; deficit: string;
  coberto: string; sobra: string; deficitRemanescente: string;
}
interface RemMes { mes: string; valor: string; diagnostico: string[] }
interface Resultado {
  configurado?: false;
  geradoEm: string;
  linhas: LinhaSugestao[];
  totaisPorMes: TotalMes[];
  remanescentes: RemMes[];
  avisos: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function fmtMoeda(v: string | number) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtMes(str: string) {
  const [a, m] = str.split('-');
  return `${MESES_ABR[parseInt(m!) - 1]}/${String(a!).slice(2)}`;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--surface-1)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 16,
};
const secLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-3)',
};
const inp: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none', width: '100%',
};
const thSt: React.CSSProperties = {
  padding: '8px 10px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
  textAlign: 'left', whiteSpace: 'nowrap',
};
const tdSt: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13, color: 'var(--text-1)',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
};

// ── Small sub-components ──────────────────────────────────────────────────────

function Tag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
      {label}
      <button type="button" onClick={onRemove}
        style={{ color: 'var(--text-3)', lineHeight: 1, cursor: 'pointer' }}>
        <X size={10} />
      </button>
    </span>
  );
}

function CamadaBadge({ camada }: { camada: 'fixado' | 'equipe' | 'novo' }) {
  const st: Record<string, React.CSSProperties> = {
    fixado: { background: 'var(--brand-500)18', color: 'var(--brand-500)' },
    equipe: { background: 'hsl(220 80% 56% / 0.12)', color: 'hsl(220 80% 55%)' },
    novo:   { background: 'hsl(142 71% 45% / 0.12)', color: 'hsl(142 60% 38%)' },
  };
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={st[camada]}>
      {camada}
    </span>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PlanejamentoWizard() {
  const { id: projetoId } = useParams<{ id: string }>();
  const { token } = useAuth();
  const navigate   = useNavigate();

  // ── remote data ───────────────────────────────────────────────────────────
  const [projeto,   setProjeto]   = useState<Projeto | null>(null);
  const [macros,    setMacros]    = useState<MacroEntrega[]>([]);
  const [metaData,  setMetaData]  = useState<MetaData | null>(null);
  const [profissoes,setProfissoes]= useState<Profissao[]>([]);
  const [colabs,    setColabs]    = useState<Colab[]>([]);
  const [loading,   setLoading]   = useState(true);

  // ── form ─────────────────────────────────────────────────────────────────
  const [macroId,        setMacroId]        = useState('');
  const [mesesSel,       setMesesSel]       = useState<Set<string>>(new Set());
  const [profSel,        setProfSel]        = useState<string[]>([]);
  const [excluidos,      setExcluidos]      = useState<{ id: string; nome: string }[]>([]);
  const [fixados,        setFixados]        = useState<{ id: string; nome: string; minHoras: string }[]>([]);
  const [maxExternos,    setMaxExternos]    = useState('');
  const [minHorasNovo,   setMinHorasNovo]   = useState('8');
  const [maxHorasPessoa, setMaxHorasPessoa] = useState('60');
  const [showAvancados,  setShowAvancados]  = useState(false);

  // picker reset keys (re-mount Combobox to clear search after selection)
  const [profKey,  setProfKey]  = useState(0);
  const [exclKey,  setExclKey]  = useState(0);
  const [fixKey,   setFixKey]   = useState(0);

  // ── result ───────────────────────────────────────────────────────────────
  const [gerando,    setGerando]    = useState(false);
  const [resultado,  setResultado]  = useState<Resultado | null>(null);
  const [erroMotor,  setErroMotor]  = useState('');

  // ── load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projetoId || !token) return;
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`/api/projetos/${projetoId}`,                   { headers: h }).then(r => r.ok ? r.json() : null),
      fetch(`/api/projetos/${projetoId}/macros`,            { headers: h }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projetos/${projetoId}/meta-apropriacao`,  { headers: h }).then(r => r.ok ? r.json() : null),
      fetch('/api/profissoes?ativo=true',                   { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/colaboradores?ativo=true',                { headers: h }).then(r => r.ok ? r.json() : []),
    ]).then(([proj, mac, meta, profs, cols]) => {
      setProjeto(proj);
      setMacros(mac ?? []);
      setMetaData(meta);
      setProfissoes(Array.isArray(profs) ? profs : []);
      // endpoint may return array or { data: [...] }
      setColabs(Array.isArray(cols) ? cols : (cols?.data ?? []));
    }).finally(() => setLoading(false));
  }, [projetoId, token]);

  // auto-select única macro
  useEffect(() => {
    if (macros.length === 1) setMacroId(macros[0]!.id);
  }, [macros]);

  // default meses = vigência com déficit > 0, não fechados
  useEffect(() => {
    if (metaData?.configurado) {
      const defaults = new Set(
        metaData.meses
          .filter(m => parseFloat(m.deficit) > 0 && !m.fechado)
          .slice(0, 12)
          .map(m => `${m.ano}-${String(m.mes).padStart(2, '0')}`),
      );
      setMesesSel(defaults);
    }
  }, [metaData]);

  // ── gerar ─────────────────────────────────────────────────────────────────
  async function handleGerar(e: React.FormEvent) {
    e.preventDefault();
    setGerando(true);
    setErroMotor('');
    setResultado(null);

    const body: Record<string, unknown> = {
      meses:          [...mesesSel].sort(),
      minHorasNovo:   parseInt(minHorasNovo)   || 8,
      maxHorasPessoa: parseInt(maxHorasPessoa) || 60,
    };
    if (profSel.length  > 0) body.profissoes = profSel;
    if (excluidos.length > 0) body.excluidos  = excluidos.map(e => e.id);
    if (fixados.length   > 0) body.fixados    = fixados.map(f => ({
      colaboradorId: f.id,
      ...(f.minHoras ? { minHoras: parseInt(f.minHoras) } : {}),
    }));
    if (maxExternos) body.maxExternos = parseInt(maxExternos);

    try {
      const res  = await fetch(`/api/projetos/${projetoId}/sugestao-equipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) setErroMotor(data.error ?? `Erro ${res.status}`);
      else         setResultado(data);
    } catch {
      setErroMotor('Erro de rede');
    } finally {
      setGerando(false);
    }
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const mesesVig     = metaData?.configurado ? metaData.meses : [];
  const temDeficit   = mesesVig.some(m => parseFloat(m.deficit) > 0);
  const exclSet      = new Set(excluidos.map(e => e.id));
  const fixSet       = new Set(fixados.map(f => f.id));
  const profSelSet   = new Set(profSel);

  const canGerar = macros.length > 0 && !!macroId && mesesSel.size > 0;

  const profOpts  = profissoes.filter(p => !profSelSet.has(p.id)).map(p => ({ id: p.id, nome: p.nome }));
  const exclOpts  = colabs.filter(c => !exclSet.has(c.id) && !fixSet.has(c.id)).map(c => ({ id: c.id, nome: c.nome }));
  const fixOpts   = colabs.filter(c => !exclSet.has(c.id) && !fixSet.has(c.id)).map(c => ({ id: c.id, nome: c.nome }));

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full gap-2" style={{ color: 'var(--text-3)' }}>
      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      Carregando…
    </div>
  );

  if (!projeto) return <div className="p-6" style={{ color: 'var(--text-3)' }}>Projeto não encontrado.</div>;

  if (metaData && !metaData.configurado) return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl">
      <button onClick={() => navigate(`/projetos/${projetoId}`)}
        className="flex items-center gap-1.5 text-xs"
        style={{ color: 'var(--text-3)' }}>
        <ArrowLeft size={13} /> {projeto.codigo} — {projeto.nome}
      </button>
      <div className="flex flex-col items-center py-12 gap-3 rounded-2xl"
        style={{ border: '1px dashed var(--border)', color: 'var(--text-3)' }}>
        <BarChart2 size={36} strokeWidth={1} />
        <p className="text-base font-semibold" style={{ color: 'var(--text-2)' }}>Projeto não configurado</p>
        <p className="text-sm text-center px-8">Configure a vigência e os valores do projeto para planejar a equipe.</p>
        <button onClick={() => navigate(`/projetos/${projetoId}`)}
          className="mt-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--brand-500)' }}>
          Ir para o projeto
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6 flex flex-col gap-6 max-w-6xl h-full overflow-y-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => navigate(`/projetos/${projetoId}`)}
          className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
          style={{ color: 'var(--text-3)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
        >
          <ArrowLeft size={13} /> {projeto.codigo} — {projeto.nome}
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--brand-500)15', border: '1px solid var(--brand-500)30' }}>
            <Brain size={18} style={{ color: 'var(--brand-500)' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Planejar Equipe</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              Sugestão automática de alocação — {projeto.codigo}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── COLUNA ESQUERDA: cobertura + formulário ─────────────────── */}
        <div className="flex flex-col gap-4" style={{ width: '100%', maxWidth: 400 }}>

          {/* Cobertura */}
          {metaData?.configurado && (
            <div style={card}>
              <p className="flex items-center gap-1.5 mb-3" style={secLabel}>
                <BarChart2 size={11} /> Cobertura do período
              </p>
              {!temDeficit ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                  style={{ background: 'hsl(142 71% 45% / 0.1)', color: 'hsl(142 60% 38%)', border: '1px solid hsl(142 71% 45% / 0.2)' }}>
                  <Check size={13} className="shrink-0" />
                  Nenhum déficit no período — o projeto já está coberto.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thSt}>Mês</th>
                        <th style={{ ...thSt, textAlign: 'right' }}>Meta HT</th>
                        <th style={{ ...thSt, textAlign: 'right' }}>Déficit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metaData.meses.map(m => {
                        const key = `${m.ano}-${String(m.mes).padStart(2, '0')}`;
                        const def = parseFloat(m.deficit);
                        return (
                          <tr key={key}>
                            <td style={tdSt}>
                              <div className="flex items-center gap-1">
                                {fmtMes(key)}
                                {m.fechado && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                    style={{ background: 'hsl(0 0% 50% / 0.12)', color: 'var(--text-3)' }}>
                                    fechado
                                  </span>
                                )}
                                {m.pinado && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                    style={{ background: 'var(--brand-500)15', color: 'var(--brand-500)' }}>
                                    pin
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ ...tdSt, textAlign: 'right' }}>{fmtMoeda(m.metaHT)}</td>
                            <td style={{
                              ...tdSt, textAlign: 'right',
                              color: def > 0 ? '#f87171' : 'var(--text-3)',
                              fontWeight: def > 0 ? 600 : undefined,
                            }}>
                              {def > 0 ? fmtMoeda(m.deficit) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Formulário de parâmetros */}
          <form onSubmit={handleGerar} className="flex flex-col gap-3">
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* ── Macro destino ─────────────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 8 }}>Macro-entrega destino *</p>
                {macros.length === 0 ? (
                  <div className="flex flex-col gap-2.5 p-3 rounded-xl"
                    style={{ background: 'hsl(38 92% 50% / 0.08)', border: '1px solid hsl(38 92% 50% / 0.25)' }}>
                    <div className="flex items-center gap-2 text-xs font-semibold"
                      style={{ color: 'hsl(38 92% 42%)' }}>
                      <AlertTriangle size={13} />
                      Este projeto ainda não tem uma macro-entrega.
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      Crie uma macro-entrega para poder planejar a equipe.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate(`/projetos/${projetoId}`)}
                      className="self-start text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                      style={{ background: 'var(--brand-500)' }}
                    >
                      Criar macro-entrega
                    </button>
                  </div>
                ) : (
                  <select
                    value={macroId}
                    onChange={e => setMacroId(e.target.value)}
                    required
                    style={{ ...inp, cursor: 'pointer' }}
                  >
                    {macros.length > 1 && <option value="">Selecione uma macro…</option>}
                    {macros.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                )}
              </div>

              {/* ── Período ───────────────────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 8 }}>Período</p>
                {mesesVig.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>Sem meses na vigência.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {mesesVig.map(m => {
                      const key     = `${m.ano}-${String(m.mes).padStart(2, '0')}`;
                      const def     = parseFloat(m.deficit);
                      const checked = mesesSel.has(key);
                      return (
                        <label
                          key={key}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl cursor-pointer select-none text-xs font-medium transition-all"
                          style={{
                            background: checked ? 'var(--brand-500)15' : 'var(--surface-2)',
                            border: `1px solid ${checked ? 'var(--brand-500)50' : 'var(--border)'}`,
                            color:  m.fechado ? 'var(--text-3)' : checked ? 'var(--brand-500)' : 'var(--text-2)',
                            opacity: m.fechado ? 0.5 : 1,
                            cursor: m.fechado ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            disabled={m.fechado}
                            onChange={ev => setMesesSel(prev => {
                              const next = new Set(prev);
                              ev.target.checked ? next.add(key) : next.delete(key);
                              return next;
                            })}
                          />
                          {fmtMes(key)}
                          {def > 0 && (
                            <span style={{ color: checked ? 'hsl(0 85% 65%)' : '#f87171', fontWeight: 700 }}>
                              {fmtMoeda(def)}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Profissões ────────────────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 8 }}>Profissões (filtro opcional)</p>
                <div className="flex flex-col gap-2">
                  {profSel.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {profSel.map(pid => {
                        const p = profissoes.find(x => x.id === pid);
                        return p ? (
                          <Tag key={pid} label={p.nome}
                            onRemove={() => setProfSel(prev => prev.filter(x => x !== pid))} />
                        ) : null;
                      })}
                    </div>
                  )}
                  {profOpts.length > 0 && (
                    <Combobox
                      key={profKey}
                      options={profOpts}
                      value=""
                      onChange={id => { setProfSel(p => [...p, id]); setProfKey(k => k + 1); }}
                      placeholder="Adicionar profissão…"
                    />
                  )}
                </div>
              </div>

              {/* ── Excluir colaboradores ─────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 8 }}>Excluir colaboradores</p>
                <div className="flex flex-col gap-2">
                  {excluidos.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {excluidos.map(e => (
                        <Tag key={e.id} label={e.nome}
                          onRemove={() => setExcluidos(prev => prev.filter(x => x.id !== e.id))} />
                      ))}
                    </div>
                  )}
                  <Combobox
                    key={exclKey}
                    options={exclOpts}
                    value=""
                    onChange={id => {
                      const c = colabs.find(x => x.id === id);
                      if (c) setExcluidos(p => [...p, { id: c.id, nome: c.nome }]);
                      setExclKey(k => k + 1);
                    }}
                    placeholder="Buscar e excluir…"
                  />
                </div>
              </div>

              {/* ── Fixar colaboradores ───────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 8 }}>Fixar colaboradores</p>
                <div className="flex flex-col gap-2">
                  {fixados.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {fixados.map(f => (
                        <div key={f.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                          <span className="flex-1 text-sm truncate" style={{ color: 'var(--text-1)' }}>
                            {f.nome}
                          </span>
                          <input
                            type="number" min={0} step={4}
                            value={f.minHoras}
                            onChange={e => setFixados(prev =>
                              prev.map(x => x.id === f.id ? { ...x, minHoras: e.target.value } : x)
                            )}
                            placeholder="min h"
                            title="Mínimo de horas (opcional)"
                            style={{ ...inp, width: 80, padding: '4px 8px', fontSize: 12 }}
                          />
                          <button type="button"
                            onClick={() => setFixados(prev => prev.filter(x => x.id !== f.id))}
                            style={{ color: 'var(--text-3)', cursor: 'pointer' }}>
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Combobox
                    key={fixKey}
                    options={fixOpts}
                    value=""
                    onChange={id => {
                      const c = colabs.find(x => x.id === id);
                      if (c) setFixados(p => [...p, { id: c.id, nome: c.nome, minHoras: '' }]);
                      setFixKey(k => k + 1);
                    }}
                    placeholder="Buscar e fixar…"
                  />
                </div>
              </div>

              {/* ── Máx. novos externos ───────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 4 }}>Máximo de novos externos</p>
                <input
                  type="number" min={0}
                  value={maxExternos}
                  onChange={e => setMaxExternos(e.target.value)}
                  placeholder="Sem limite"
                  style={{ ...inp, width: 160 }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  IDs distintos com camada "novo" em toda a execução.
                </p>
              </div>

              {/* ── Avançados ─────────────────────────────────── */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAvancados(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: 'var(--text-3)' }}
                >
                  {showAvancados ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  Opções avançadas
                </button>
                {showAvancados && (
                  <div className="flex gap-4 mt-3">
                    <div className="flex-1">
                      <p style={{ ...secLabel, marginBottom: 4 }}>Min horas — novo</p>
                      <input type="number" min={0} step={4} value={minHorasNovo}
                        onChange={e => setMinHorasNovo(e.target.value)} style={inp} />
                      <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Padrão: 8h</p>
                    </div>
                    <div className="flex-1">
                      <p style={{ ...secLabel, marginBottom: 4 }}>Max horas — pessoa</p>
                      <input type="number" min={4} step={4} value={maxHorasPessoa}
                        onChange={e => setMaxHorasPessoa(e.target.value)} style={inp} />
                      <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Padrão: 60h</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* erro do motor */}
            {erroMotor && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm"
                style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 62%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>
                <AlertTriangle size={14} className="shrink-0" /> {erroMotor}
              </div>
            )}

            {/* Gerar */}
            <button
              type="submit"
              disabled={!canGerar || gerando}
              className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity"
              style={{
                background: canGerar ? 'var(--brand-500)' : 'var(--surface-3)',
                color:  canGerar ? 'white' : 'var(--text-3)',
                cursor: canGerar && !gerando ? 'pointer' : 'not-allowed',
                opacity: gerando ? 0.7 : 1,
                border: canGerar ? 'none' : '1px solid var(--border)',
              }}
            >
              {gerando ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                    <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Executando motor…
                </>
              ) : (
                <><Zap size={15} /> Gerar sugestão</>
              )}
            </button>

            {!macroId && macros.length > 0 && (
              <p className="text-xs text-center -mt-1" style={{ color: 'var(--text-3)' }}>
                Selecione uma macro-entrega para continuar.
              </p>
            )}
            {mesesSel.size === 0 && macros.length > 0 && (
              <p className="text-xs text-center -mt-1" style={{ color: 'var(--text-3)' }}>
                Selecione ao menos um mês do período.
              </p>
            )}
          </form>
        </div>

        {/* ── COLUNA DIREITA: resultado ──────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!resultado && !gerando && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-2xl"
              style={{ border: '1px dashed var(--border)', color: 'var(--text-3)' }}>
              <Brain size={40} strokeWidth={1} />
              <p className="text-sm">Configure os parâmetros e clique em Gerar sugestão.</p>
            </div>
          )}

          {gerando && (
            <div className="flex items-center justify-center py-20 gap-2" style={{ color: 'var(--text-3)' }}>
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Executando motor de sugestão…
            </div>
          )}

          {resultado && resultado.configurado === false && (
            <div className="flex flex-col items-center py-10 gap-2" style={{ color: 'var(--text-3)' }}>
              <AlertTriangle size={28} strokeWidth={1} />
              <p className="text-sm">O projeto não está configurado para o motor de sugestões.</p>
            </div>
          )}

          {resultado && resultado.configurado !== false && (
            <>
              {/* Avisos */}
              {resultado.avisos.length > 0 && (
                <div style={card} className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5" style={secLabel}>
                    <Info size={11} /> Avisos
                  </p>
                  {resultado.avisos.map((a, i) => (
                    <div key={i} className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: 'hsl(38 92% 50% / 0.08)', color: 'hsl(38 92% 42%)', border: '1px solid hsl(38 92% 50% / 0.18)' }}>
                      {a}
                    </div>
                  ))}
                </div>
              )}

              {/* Resumo por mês */}
              {resultado.totaisPorMes.length > 0 && (
                <div style={card}>
                  <p style={{ ...secLabel, marginBottom: 12 }}>Resumo por mês</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thSt}>Mês</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Meta HT</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Déficit</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Coberto</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Sobra</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Remanescente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.totaisPorMes.map(t => {
                          const rem = parseFloat(t.deficitRemanescente);
                          const def = parseFloat(t.deficit);
                          return (
                            <tr key={t.mes}>
                              <td style={tdSt}>{fmtMes(t.mes)}</td>
                              <td style={{ ...tdSt, textAlign: 'right' }}>{fmtMoeda(t.metaHT)}</td>
                              <td style={{ ...tdSt, textAlign: 'right', color: def > 0 ? '#f87171' : 'var(--text-3)' }}>
                                {def > 0 ? fmtMoeda(t.deficit) : '—'}
                              </td>
                              <td style={{ ...tdSt, textAlign: 'right', color: 'hsl(142 60% 38%)', fontWeight: 600 }}>
                                {fmtMoeda(t.coberto)}
                              </td>
                              <td style={{ ...tdSt, textAlign: 'right', color: 'var(--text-3)' }}>
                                {parseFloat(t.sobra) > 0 ? fmtMoeda(t.sobra) : '—'}
                              </td>
                              <td style={{
                                ...tdSt, textAlign: 'right',
                                color: rem > 0 ? '#f87171' : 'var(--text-3)',
                                fontWeight: rem > 0 ? 600 : undefined,
                              }}>
                                {rem > 0 ? fmtMoeda(t.deficitRemanescente) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Linhas */}
              <div style={card}>
                <div className="flex items-center justify-between mb-3">
                  <p style={secLabel}>
                    Sugestão de equipe — {resultado.linhas.length} linha{resultado.linhas.length !== 1 ? 's' : ''}
                  </p>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {new Date(resultado.geradoEm).toLocaleTimeString('pt-BR')}
                  </span>
                </div>
                {resultado.linhas.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-2" style={{ color: 'var(--text-3)' }}>
                    <AlertTriangle size={24} strokeWidth={1} />
                    <p className="text-sm">Nenhuma sugestão gerada.</p>
                    <p className="text-xs">Verifique as tarifas dos candidatos e os parâmetros.</p>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thSt}>Colaborador</th>
                          <th style={thSt}>Profissão</th>
                          <th style={thSt}>Mês</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Horas</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Tarifa/h</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Receita</th>
                          <th style={thSt}>Camada</th>
                          <th style={{ ...thSt, maxWidth: 200 }}>Explicação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.linhas.map((l, i) => (
                          <tr key={i}>
                            <td style={{ ...tdSt, fontWeight: 500 }}>{l.nome}</td>
                            <td style={{ ...tdSt, color: 'var(--text-3)' }}>{l.profissao || '—'}</td>
                            <td style={tdSt}>{fmtMes(l.mes)}</td>
                            <td style={{ ...tdSt, textAlign: 'right', fontWeight: 600 }}>{l.horas}h</td>
                            <td style={{ ...tdSt, textAlign: 'right' }}>{fmtMoeda(l.tarifa)}</td>
                            <td style={{ ...tdSt, textAlign: 'right', color: 'hsl(142 60% 38%)', fontWeight: 600 }}>
                              {fmtMoeda(l.receita)}
                            </td>
                            <td style={{ ...tdSt, padding: '6px 10px' }}>
                              <CamadaBadge camada={l.camada} />
                            </td>
                            <td
                              style={{ ...tdSt, color: 'var(--text-3)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
                              title={l.explicacao}
                            >
                              {l.explicacao}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Remanescentes */}
              {resultado.remanescentes.length > 0 && (
                <div style={card}>
                  <p className="flex items-center gap-1.5 mb-3" style={secLabel}>
                    <AlertTriangle size={11} /> Meses com déficit remanescente
                  </p>
                  <div className="flex flex-col gap-2">
                    {resultado.remanescentes.map(r => (
                      <div key={r.mes} className="px-3 py-2.5 rounded-xl"
                        style={{ background: 'hsl(0 85% 60% / 0.06)', border: '1px solid hsl(0 85% 60% / 0.15)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                            {fmtMes(r.mes)}
                          </span>
                          <span className="text-xs font-bold" style={{ color: '#f87171' }}>
                            {fmtMoeda(r.valor)} não cobertos
                          </span>
                        </div>
                        {r.diagnostico.map((d, i) => (
                          <p key={i} className="text-xs" style={{ color: 'var(--text-3)' }}>· {d}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
