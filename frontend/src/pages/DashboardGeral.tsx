import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGestorFiltro } from '../context/GestorFiltroContext';
import SeletorMes from '../components/SeletorMes';
import SeletorGestor from '../components/SeletorGestor';

// ── Tipos ────────────────────────────────────────────────────────────────────

type CategoriaPrazo = 'alta' | 'media' | 'baixa' | 'sem_prazo';

interface ItemDash {
  categoria:       CategoriaPrazo;
  horasPlanejadas: string;        // sempre presente, '0' quando sem allocs
  horasRealizadas: string | null; // null = sem apontamento
  custoPlanejado:  string | null;
  gestorId:        string | null;
  gestorNome:      string | null;
}

interface DashResponse {
  itens:            ItemDash[];
  pausados:         ItemDash[];
  headcountAlocado: number;
  emSobrecarga:     number;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const CATS: CategoriaPrazo[] = ['alta', 'media', 'baixa', 'sem_prazo'];

const CAT_INFO: Record<CategoriaPrazo, { label: string; dot: string }> = {
  alta:      { label: 'Alta',      dot: '#ef4444' },
  media:     { label: 'Média',     dot: '#f59e0b' },
  baixa:     { label: 'Baixa',     dot: '#4ade80' },
  sem_prazo: { label: 'Sem prazo', dot: 'var(--text-2)' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function taxaColor(pct: number): string {
  if (pct >= 80) return '#4ade80';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function fmtH(h: number): string {
  return `${Math.round(h)}h`;
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function KpiCard({ label, value, valueColor }: {
  label:       string;
  value:       string | number;
  valueColor?: string;
}) {
  const isStr = typeof value === 'string';
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--text-3)',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: isStr ? 18 : 28,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
        color: valueColor ?? 'var(--text-1)',
      }}>
        {value}
      </span>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '16px 20px',
    }}>
      <h2 style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14,
      }}>
        {titulo}
      </h2>
      {children}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function DashboardGeral() {
  const { token, user } = useAuth();
  const { gestorIdFiltro } = useGestorFiltro();
  const navigate = useNavigate();

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [dados, setDados]       = useState<DashResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [erro, setErro]         = useState('');
  const [gestorNomeVis, setGestorNomeVis] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setErro('');
    const qs = gestorIdFiltro
      ? `/api/dashboards/projetos?ano=${ano}&mes=${mes}&gestorId=${gestorIdFiltro}`
      : `/api/dashboards/projetos?ano=${ano}&mes=${mes}`;
    fetch(qs, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: DashResponse) => setDados(d))
      .catch(() => setErro('Erro ao carregar dashboard.'))
      .finally(() => setLoading(false));
  }, [token, ano, mes, gestorIdFiltro]);

  useEffect(() => {
    if (!gestorIdFiltro) { setGestorNomeVis(null); return; }
    const nome = dados?.itens[0]?.gestorNome ?? dados?.pausados[0]?.gestorNome ?? null;
    if (nome) setGestorNomeVis(nome);
  }, [gestorIdFiltro, dados]);

  const todos          = useMemo(() => [...(dados?.itens ?? []), ...(dados?.pausados ?? [])], [dados]);
  const nTotal         = todos.length;
  const nAlta          = todos.filter(x => x.categoria === 'alta').length;
  const headcount      = dados?.headcountAlocado ?? 0;
  const sobrecarga     = dados?.emSobrecarga ?? 0;
  const totalPlan      = todos.reduce((s, x) => s + (x.custoPlanejado ? parseFloat(x.custoPlanejado) : 0), 0);
  // Taxa de horas: soma(realizado) / soma(planejado) — null tratado como 0h no numerador
  // taxaGlobal=null quando sem horas planejadas (não divide por zero, mostra "—")
  const totalHorasPlan = todos.reduce((s, x) => s + parseFloat(x.horasPlanejadas), 0);
  const totalHorasReal = todos.reduce((s, x) => s + (x.horasRealizadas ? parseFloat(x.horasRealizadas) : 0), 0);
  const taxaGlobal     = totalHorasPlan > 0 ? Math.round((totalHorasReal / totalHorasPlan) * 100) : null;

  const escopoLabel = gestorIdFiltro
    ? `visualizando como ${gestorNomeVis ?? '…'}`
    : user?.role === 'gestor'
      ? `seus ${nTotal} projetos`
      : 'todos os gestores';

  const isDiretor = user?.role === 'diretor';
  const isGestor  = user?.role === 'gestor';

  // Ranking de apontamento por gestor (liderança = não gestor, não diretor)
  // Acumula HORAS (plan/real) por gestor — não contagem de projetos
  const rankingGestores = useMemo(() => {
    if (isGestor || isDiretor) return [];
    const map = new Map<string, { nome: string; plan: number; real: number }>();
    for (const x of todos) {
      const key  = x.gestorId ?? '__sem__';
      const nome = x.gestorNome ?? '(sem gestor)';
      if (!map.has(key)) map.set(key, { nome, plan: 0, real: 0 });
      const e = map.get(key)!;
      e.plan += parseFloat(x.horasPlanejadas);
      e.real += x.horasRealizadas ? parseFloat(x.horasRealizadas) : 0;
    }
    return [...map.values()]
      .map(e => ({ ...e, pct: e.plan > 0 ? Math.round((e.real / e.plan) * 100) : null }))
      .sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1)); // sem horas planejadas vai ao final
  }, [todos, isGestor, isDiretor]);

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">

      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <LayoutDashboard size={20} style={{ color: 'var(--brand-500)' }} />
            Início
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
            Visão geral do mês
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SeletorMes mes={mes} ano={ano} onMes={setMes} onAno={setAno} />
          <SeletorGestor />
          {!loading && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
              Escopo: {escopoLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── Conteúdo ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Carregando…
        </div>
      ) : erro ? (
        <div className="text-sm" style={{ color: '#b42318' }}>{erro}</div>
      ) : (
        <div className="flex flex-col" style={{ gap: 16 }}>

          {/* ── Faixa de veredito ─────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <KpiCard label="Projetos" value={nTotal} />
            <KpiCard
              label="Em Alta"
              value={nAlta}
              valueColor={nAlta > 0 ? '#ef4444' : 'var(--text-3)'}
            />
            <KpiCard label="Headcount" value={headcount} />
            <KpiCard
              label="Sobrecarga"
              value={sobrecarga}
              valueColor={sobrecarga > 0 ? '#ef4444' : 'var(--text-3)'}
            />
            <KpiCard label="Custo Previsto" value={fmtMoeda(totalPlan)} />
          </div>

          {/* ── Prazo ─────────────────────────────────────────────────────── */}
          <Bloco titulo="Por Prazo">
            {/* Barra proporcional */}
            {nTotal > 0 && (
              <div style={{ display: 'flex', height: 6, borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
                {CATS.map(cat => {
                  const n = todos.filter(x => x.categoria === cat).length;
                  if (n === 0) return null;
                  const { dot } = CAT_INFO[cat];
                  return (
                    <div key={cat} style={{
                      width: `${(n / nTotal) * 100}%`,
                      background: dot.startsWith('var(') ? 'var(--border-strong)' : dot,
                      opacity: 0.85,
                    }} />
                  );
                })}
              </div>
            )}
            {/* Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CATS.map(cat => {
                const count = todos.filter(x => x.categoria === cat).length;
                const { label, dot } = CAT_INFO[cat];
                const isCssVar = dot.startsWith('var(');
                const chipBase: React.CSSProperties = {
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 20, fontSize: 13,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                };
                const inner = (
                  <>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: isCssVar ? 'var(--text-2)' : dot, flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-2)' }}>{label}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text-1)' }}>{count}</span>
                  </>
                );
                if (isDiretor) {
                  return <span key={cat} style={chipBase}>{inner}</span>;
                }
                return (
                  <button
                    key={cat}
                    onClick={() => navigate(`/prioridades?categoria=${cat}`)}
                    style={{ ...chipBase, cursor: 'pointer', transition: 'border-color 120ms' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = isCssVar ? 'var(--border-strong)' : `${dot}99`; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </Bloco>

          {/* ── Apontamento ───────────────────────────────────────────────── */}
          <Bloco titulo="Apontamento do mês">
            {isGestor ? (
              // Gestor: percentual de HORAS em destaque
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{
                    fontSize: 40, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
                    color: taxaGlobal === null ? 'var(--text-3)' : taxaColor(taxaGlobal),
                  }}>
                    {taxaGlobal === null ? '—' : `${taxaGlobal}%`}
                  </span>
                  {taxaGlobal !== null && (
                    <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                      {fmtH(totalHorasReal)} de {fmtH(totalHorasPlan)}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {taxaGlobal === null ? 'Nenhuma hora planejada no período' : 'Horas com realizado preenchido'}
                </p>
              </div>
            ) : isDiretor ? (
              // Diretor: texto plano, sem barras, sem links
              <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
                {taxaGlobal === null ? (
                  <span style={{ color: 'var(--text-3)' }}>Nenhuma hora planejada no período.</span>
                ) : (
                  <>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <b style={{ color: 'var(--text-1)' }}>{fmtH(totalHorasReal)}</b> de{' '}
                      <b style={{ color: 'var(--text-1)' }}>{fmtH(totalHorasPlan)}</b>
                    </span>
                    {' '}com realizado preenchido ({taxaGlobal}%)
                  </>
                )}
              </div>
            ) : rankingGestores.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Sem dados no período.</p>
            ) : (
              // Liderança: ranking pior → melhor com barras horizontais (em HORAS)
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rankingGestores.map(g => {
                  const pct = g.pct;
                  return (
                    <div key={g.nome} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        width: 150, fontSize: 12, color: 'var(--text-2)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0,
                      }}>
                        {g.nome}
                      </span>
                      <div style={{ flex: 1, background: 'var(--surface-3)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{
                          width: pct === null ? '0%' : `${pct}%`, height: '100%',
                          background: pct === null ? 'var(--border)' : taxaColor(pct), borderRadius: 4,
                          transition: 'width 300ms ease',
                        }} />
                      </div>
                      <span style={{
                        width: 38, fontSize: 12, fontVariantNumeric: 'tabular-nums',
                        color: pct === null ? 'var(--text-3)' : taxaColor(pct),
                        fontWeight: 600, textAlign: 'right', flexShrink: 0,
                      }}>
                        {pct === null ? '—' : `${pct}%`}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, minWidth: 80 }}>
                        {pct === null ? 'sem plan.' : `${fmtH(g.real)}/${fmtH(g.plan)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Bloco>

        </div>
      )}
    </div>
  );
}
