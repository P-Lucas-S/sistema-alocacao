import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGestorFiltro } from '../context/GestorFiltroContext';
import SeletorMes from '../components/SeletorMes';
import SeletorGestor from '../components/SeletorGestor';
import KpiCard from '../components/KpiCard';
import Bloco from '../components/Bloco';

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

interface DashResponsePadrao {
  itens:            ItemDash[];
  pausados:         ItemDash[];
  headcountAlocado: number;
  emSobrecarga:     number;
}

interface CategoriaAgg {
  categoria: CategoriaPrazo;
  count:     number;
  custo:     string;
}

// Payload do diretor: SÓ agregados — nunca nomes de projeto/gestor/colaborador.
// A tela dele monta a mesma faixa de veredito e os mesmos chips, mas a partir
// de números já prontos, não de listas (fase A-meio da auditoria, item 7).
interface DashResponseDiretor {
  nTotal:            number;
  custoPorCategoria: CategoriaAgg[];
  nPrestac:          number;
  nSemApon:          number;
  totalPlan:         string;
  totalHorasPlan:    string;
  totalHorasReal:    string;
  headcountAlocado:  number;
  emSobrecarga:      number;
  totalPausados:     number;
  gestorNome:        string | null;
}

type DashResponse = DashResponsePadrao | DashResponseDiretor;

// Payload de /dashboards/capacidade para o diretor — mesmo contrato de
// DashboardCapacidade.tsx (fase A-meio). Consolidação: o Início do diretor
// chama esse endpoint TAMBÉM, só pra ele, pra montar o bloco de ocupação.
type Tier = 'sobrecarregado' | 'saudavel' | 'ocioso';

interface CapAggDiretor {
  contagensPorTier: Record<Tier, number>;
  headcountAlocado: number;
  emSobrecarga:     number;
  gestorNome:       string | null;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const CATS: CategoriaPrazo[] = ['alta', 'media', 'baixa', 'sem_prazo'];

const CAT_INFO: Record<CategoriaPrazo, { label: string; dot: string }> = {
  alta:      { label: 'Alta',      dot: '#ef4444' },
  media:     { label: 'Média',     dot: '#f59e0b' },
  baixa:     { label: 'Baixa',     dot: '#4ade80' },
  sem_prazo: { label: 'Sem prazo', dot: 'var(--text-2)' },
};

const TIER_ORDER: Tier[] = ['sobrecarregado', 'saudavel', 'ocioso'];
const TIER_INFO: Record<Tier, { label: string; cor: string }> = {
  sobrecarregado: { label: 'Sobrecarregado', cor: '#ef4444' },
  saudavel:       { label: 'Saudável',       cor: '#22c55e' },
  ocioso:         { label: 'Ocioso',          cor: '#94a3b8' },
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

// ── Componente principal ──────────────────────────────────────────────────────

export default function DashboardGeral() {
  const { token, user } = useAuth();
  const { gestorIdFiltro } = useGestorFiltro();
  const navigate = useNavigate();

  const isDiretor = user?.role === 'diretor';
  const isGestor  = user?.role === 'gestor';

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [dados, setDados]       = useState<DashResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [erro, setErro]         = useState('');
  const [gestorNomeVis, setGestorNomeVis] = useState<string | null>(null);

  // Consolidação: o Início do diretor reúne tudo que estava espalhado em
  // Prioridades e Capacidade — inclui o bloco de ocupação da equipe, que
  // exige chamar /dashboards/capacidade TAMBÉM, só pra ele.
  const [capAgg, setCapAgg]         = useState<CapAggDiretor | null>(null);
  const [capLoading, setCapLoading] = useState(true);

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
    if (!token || !isDiretor) { setCapAgg(null); setCapLoading(false); return; }
    setCapLoading(true);
    const qs = gestorIdFiltro
      ? `/api/dashboards/capacidade?ano=${ano}&mes=${mes}&gestorId=${gestorIdFiltro}`
      : `/api/dashboards/capacidade?ano=${ano}&mes=${mes}`;
    fetch(qs, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: CapAggDiretor) => setCapAgg(d))
      .catch(() => setCapAgg(null))
      .finally(() => setCapLoading(false));
  }, [token, ano, mes, gestorIdFiltro, isDiretor]);

  useEffect(() => {
    if (!gestorIdFiltro) { setGestorNomeVis(null); return; }
    // Diretor recebe o gestorNome pronto do backend (payload sem listas);
    // os demais papéis derivam do primeiro item das listas, como antes.
    const nome = isDiretor
      ? (dados as DashResponseDiretor | null)?.gestorNome ?? null
      : (dados as DashResponsePadrao | null)?.itens[0]?.gestorNome
        ?? (dados as DashResponsePadrao | null)?.pausados[0]?.gestorNome
        ?? null;
    if (nome) setGestorNomeVis(nome);
  }, [gestorIdFiltro, dados, isDiretor]);

  // Diretor: agregados já vêm prontos do backend. Demais papéis: derivam das
  // listas itens+pausados, como sempre. Nunca misture as duas fontes.
  const dadosDiretor = isDiretor ? (dados as DashResponseDiretor | null) : null;
  const dadosPadrao  = !isDiretor ? (dados as DashResponsePadrao | null) : null;

  const todos = useMemo(
    () => [...(dadosPadrao?.itens ?? []), ...(dadosPadrao?.pausados ?? [])],
    [dadosPadrao],
  );

  const nTotal = isDiretor ? (dadosDiretor?.nTotal ?? 0) : todos.length;

  const contagensPorCategoria: Record<CategoriaPrazo, number> = isDiretor
    ? {
        alta:      dadosDiretor?.custoPorCategoria.find(c => c.categoria === 'alta')?.count ?? 0,
        media:     dadosDiretor?.custoPorCategoria.find(c => c.categoria === 'media')?.count ?? 0,
        baixa:     dadosDiretor?.custoPorCategoria.find(c => c.categoria === 'baixa')?.count ?? 0,
        sem_prazo: dadosDiretor?.custoPorCategoria.find(c => c.categoria === 'sem_prazo')?.count ?? 0,
      }
    : {
        alta:      todos.filter(x => x.categoria === 'alta').length,
        media:     todos.filter(x => x.categoria === 'media').length,
        baixa:     todos.filter(x => x.categoria === 'baixa').length,
        sem_prazo: todos.filter(x => x.categoria === 'sem_prazo').length,
      };

  const nAlta      = contagensPorCategoria.alta;
  const headcount  = dados?.headcountAlocado ?? 0;
  const sobrecarga = dados?.emSobrecarga ?? 0;

  const totalPlan = isDiretor
    ? parseFloat(dadosDiretor?.totalPlan ?? '0')
    : todos.reduce((s, x) => s + (x.custoPlanejado ? parseFloat(x.custoPlanejado) : 0), 0);

  // Taxa de horas: soma(realizado) / soma(planejado) — null tratado como 0h no numerador
  // taxaGlobal=null quando sem horas planejadas (não divide por zero, mostra "—")
  const totalHorasPlan = isDiretor
    ? parseFloat(dadosDiretor?.totalHorasPlan ?? '0')
    : todos.reduce((s, x) => s + parseFloat(x.horasPlanejadas), 0);
  const totalHorasReal = isDiretor
    ? parseFloat(dadosDiretor?.totalHorasReal ?? '0')
    : todos.reduce((s, x) => s + (x.horasRealizadas ? parseFloat(x.horasRealizadas) : 0), 0);
  const taxaGlobal = totalHorasPlan > 0 ? Math.round((totalHorasReal / totalHorasPlan) * 100) : null;

  const escopoLabel = gestorIdFiltro
    ? `visualizando como ${gestorNomeVis ?? '…'}`
    : user?.role === 'gestor'
      ? `seus ${nTotal} projetos`
      : 'todos os gestores';

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

  // Custo por categoria (4 linhas) — mesmo bloco que hoje vive em Prioridades
  // para o diretor, agora consolidado aqui.
  const custoPorCategoriaDiretor = isDiretor
    ? (dadosDiretor?.custoPorCategoria ?? [])
        .map(c => ({ cat: c.categoria, count: c.count, custo: parseFloat(c.custo) }))
        .filter(c => c.count > 0)
    : [];

  // Página só termina de carregar pro diretor quando os DOIS fetches voltam.
  const contentLoading = loading || (isDiretor && capLoading);

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
          {!contentLoading && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
              Escopo: {escopoLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── Conteúdo ───────────────────────────────────────────────────────── */}
      {contentLoading ? (
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
            <KpiCard label="Colaboradores" value={headcount} />
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
                  const n = contagensPorCategoria[cat];
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
                const count = contagensPorCategoria[cat];
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

          {/* ── Custo por Categoria (só diretor) — consolidado de Prioridades ── */}
          {isDiretor && (
            <Bloco titulo="Custo por Categoria">
              {custoPorCategoriaDiretor.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Nenhum projeto no período.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {custoPorCategoriaDiretor.map(({ cat, count, custo }) => {
                    const { label, dot } = CAT_INFO[cat];
                    const isCssVar = dot.startsWith('var(');
                    const dotColor = isCssVar ? 'var(--text-2)' : dot;
                    const barPct   = totalPlan > 0 ? (custo / totalPlan) * 100 : (count / nTotal) * 100;
                    return (
                      <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 110, flexShrink: 0 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{label}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>{count}</span>
                        </div>
                        <div style={{ flex: 1, background: 'var(--surface-3)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                          <div style={{
                            width: `${barPct}%`, height: '100%',
                            background: dotColor, borderRadius: 4, opacity: 0.8,
                            transition: 'width 300ms ease',
                          }} />
                        </div>
                        <span style={{ width: 100, fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: 'var(--text-2)', flexShrink: 0 }}>
                          {custo > 0
                            ? custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
                            : '—'
                          }
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Bloco>
          )}

          {/* ── Ocupação da Equipe (só diretor) — consolidado de Capacidade ─── */}
          {isDiretor && capAgg && (
            <Bloco titulo="Ocupação da Equipe">
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
                {TIER_ORDER.map(tier => {
                  const n = capAgg.contagensPorTier[tier];
                  if (n === 0 || capAgg.headcountAlocado === 0) return null;
                  return (
                    <div key={tier} style={{
                      width: `${(n / capAgg.headcountAlocado) * 100}%`,
                      background: TIER_INFO[tier].cor,
                      opacity: 0.9,
                    }} />
                  );
                })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TIER_ORDER.map(tier => {
                  const count = capAgg.contagensPorTier[tier];
                  const { label, cor } = TIER_INFO[tier];
                  return (
                    <span key={tier} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 20, fontSize: 13,
                      border: '1px solid var(--border)', background: 'var(--surface-2)',
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                      <span style={{ color: 'var(--text-2)' }}>{label}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text-1)' }}>{count}</span>
                    </span>
                  );
                })}
              </div>
            </Bloco>
          )}

          {/* ── Apontamento ───────────────────────────────────────────────── */}
          <Bloco titulo="Apontamento do mês">
            {isGestor || isDiretor ? (
              // Gestor e diretor: percentual de HORAS em destaque com cor contextual
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
