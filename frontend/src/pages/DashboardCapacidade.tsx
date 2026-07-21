import React, { useState, useEffect, useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGestorFiltro } from '../context/GestorFiltroContext';
import SeletorMes from '../components/SeletorMes';
import SeletorGestor from '../components/SeletorGestor';

// ── Tipos ────────────────────────────────────────────────────────────────────

type Tier = 'sobrecarregado' | 'saudavel' | 'ocioso';

interface ColabCap {
  id:              string;
  nome:            string;
  profissao:       string | null;
  horasPlanejadas: string;        // global (todos os gestores)
  horasRealizadas: string | null; // global (todos os gestores)
  tier:            Tier;
}

interface CapResponsePadrao {
  colaboradores:    ColabCap[];
  headcountAlocado: number;
  emSobrecarga:     number;
  gestorNome:       string | null;
}

// Payload do diretor: SÓ as contagens por tier — nunca o array com nomes
// (fase A-meio da auditoria, item 7).
interface CapResponseDiretor {
  contagensPorTier: Record<Tier, number>;
  headcountAlocado: number;
  emSobrecarga:     number;
  gestorNome:       string | null;
}

type CapResponse = CapResponsePadrao | CapResponseDiretor;

// ── Constantes ───────────────────────────────────────────────────────────────

const TETO = 220;
const TIER_ORDER: Tier[] = ['sobrecarregado', 'saudavel', 'ocioso'];
const TIER_INFO: Record<Tier, { label: string; cor: string; faixa: string }> = {
  sobrecarregado: { label: 'Sobrecarregado', cor: '#ef4444', faixa: '≥ 95% do teto (≥ 209h)' },
  saudavel:       { label: 'Saudável',        cor: '#22c55e', faixa: '50–94% do teto (110–208h)' },
  ocioso:         { label: 'Ocioso',           cor: '#94a3b8', faixa: '< 50% do teto (< 110h)' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtH(h: number): string {
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

function fmtRealizado(real: string | null, plan: string): {
  temRealizado: boolean; barPct: number; texto: string;
} {
  const planN   = parseFloat(plan);
  const planStr = Number.isInteger(planN) ? `${planN}` : planN.toFixed(1);
  if (real === null) return { temRealizado: false, barPct: 0, texto: `${planStr}h · —` };
  const realN   = parseFloat(real);
  const realStr = Number.isInteger(realN) ? `${realN}` : realN.toFixed(1);
  const pct     = planN > 0 ? Math.round((realN / planN) * 100) : 0;
  return {
    temRealizado: true,
    barPct:       planN > 0 ? Math.min((realN / planN) * 100, 100) : 0,
    texto:        `${realStr}/${planStr}h · ${pct}%`,
  };
}

// ── Barra de ocupação — cor por tier, marcadores de limiar ───────────────────

function BarraOcupacao({ horas, height = 8 }: { horas: number; height?: number }) {
  const pct = Math.min((horas / TETO) * 100, 100);
  const cor = horas >= 209 ? '#ef4444' : horas >= 110 ? '#22c55e' : '#94a3b8';
  return (
    <div style={{
      position: 'relative', flex: 1, height,
      borderRadius: 9999, overflow: 'hidden',
      background: 'var(--surface-3)', minWidth: 80,
    }}>
      <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: '100%', background: cor }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: 'var(--border)', opacity: 0.5 }} />
      <div style={{ position: 'absolute', left: '95%', top: 0, width: 1, height: '100%', background: 'var(--border)', opacity: 0.5 }} />
    </div>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, valueColor }: {
  label: string; value: string | number; valueColor?: string;
}) {
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--text-3)',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1, color: valueColor ?? 'var(--text-1)',
      }}>
        {value}
      </span>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function DashboardCapacidade() {
  const { token, user } = useAuth();
  const { gestorIdFiltro } = useGestorFiltro();

  const now = new Date();
  const [mes, setMes]         = useState(now.getMonth() + 1);
  const [ano, setAno]         = useState(now.getFullYear());
  const [dados, setDados]     = useState<CapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');
  const [tiersAtivos, setTiersAtivos] = useState<Set<Tier>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const isDiretor = user?.role === 'diretor';
  const isGestor  = user?.role === 'gestor';

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setErro('');
    const qs = gestorIdFiltro
      ? `/api/dashboards/capacidade?ano=${ano}&mes=${mes}&gestorId=${gestorIdFiltro}`
      : `/api/dashboards/capacidade?ano=${ano}&mes=${mes}`;
    fetch(qs, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: CapResponse) => setDados(d))
      .catch(() => setErro('Erro ao carregar dashboard.'))
      .finally(() => setLoading(false));
  }, [token, ano, mes, gestorIdFiltro]);

  useEffect(() => { setExpandedIds(new Set()); }, [dados]);

  // Diretor: contagens já vêm prontas do backend (payload sem o array de
  // colaboradores). Demais papéis: derivam do array, como sempre.
  const dadosDiretor = isDiretor ? (dados as CapResponseDiretor | null) : null;
  const dadosPadrao  = !isDiretor ? (dados as CapResponsePadrao | null) : null;

  const colabs     = dadosPadrao?.colaboradores ?? [];
  const headcount  = dados?.headcountAlocado ?? 0;
  const sobrecarga = dados?.emSobrecarga ?? 0;
  const nTotal     = isDiretor ? headcount : colabs.length;
  const semDados   = isDiretor ? headcount === 0 : colabs.length === 0;

  const contPorTier = useMemo(() => {
    if (isDiretor) {
      return dadosDiretor?.contagensPorTier ?? { sobrecarregado: 0, saudavel: 0, ocioso: 0 };
    }
    const m: Record<Tier, number> = { sobrecarregado: 0, saudavel: 0, ocioso: 0 };
    for (const c of colabs) m[c.tier]++;
    return m;
  }, [colabs, isDiretor, dadosDiretor]);

  const listaFiltrada = useMemo(
    () => tiersAtivos.size === 0 ? colabs : colabs.filter(c => tiersAtivos.has(c.tier)),
    [colabs, tiersAtivos],
  );

  const toggleTier   = (t: Tier) => setTiersAtivos(prev => {
    const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next;
  });
  const toggleExpand = (id: string) => setExpandedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const escopoLabel = gestorIdFiltro
    ? `visualizando como ${dados?.gestorNome ?? '…'}`
    : isGestor
      ? `seus ${nTotal} colaboradores`
      : 'todos os gestores';

  // ── Estilos compartilhados da tabela ──────────────────────────────────────
  const thStyle: React.CSSProperties = {
    padding: '8px 12px', fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)',
    textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', fontSize: 13, color: 'var(--text-1)',
    borderBottom: '1px solid var(--border)', verticalAlign: 'middle',
  };

  // ── Linha com expansão ────────────────────────────────────────────────────
  function LinhaColab({ colab }: { colab: ColabCap }) {
    const planN    = parseFloat(colab.horasPlanejadas);
    const exec     = fmtRealizado(colab.horasRealizadas, colab.horasPlanejadas);
    const expanded = expandedIds.has(colab.id);
    const { cor, faixa } = TIER_INFO[colab.tier];
    return (
      <>
        <tr className="hover:bg-[var(--surface-3)] transition-colors duration-100">
          {/* COLABORADOR */}
          <td style={tdStyle}>
            <span style={{ fontWeight: 600 }}>{colab.nome}</span>
          </td>
          {/* PROFISSÃO */}
          <td style={{ ...tdStyle, color: 'var(--text-2)' }}>
            {colab.profissao ?? '—'}
          </td>
          {/* PLANEJADO: barra de ocupação + "Xh/220h" colorido por tier */}
          <td style={tdStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarraOcupacao horas={planN} />
              <span style={{
                fontSize: 12, fontVariantNumeric: 'tabular-nums',
                color: cor, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {fmtH(planN)}/{TETO}h
              </span>
            </div>
          </td>
          {/* REALIZADO: mini-barra + texto via fmtRealizado (mesma lógica de Prioridades) */}
          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{
                width: 60, height: 4, borderRadius: 2,
                background: exec.temRealizado ? 'hsl(0 0% 50% / 0.15)' : 'transparent',
                border: exec.temRealizado ? 'none' : '1.5px solid var(--border-strong)',
                position: 'relative', overflow: 'hidden',
              }}>
                {exec.temRealizado && (
                  <div style={{
                    position: 'absolute', left: 0, top: 0,
                    width: `${exec.barPct}%`, height: '100%',
                    background: 'var(--brand-500)',
                  }} />
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{exec.texto}</span>
            </div>
          </td>
          {/* EXPANSÃO */}
          <td style={{ ...tdStyle, padding: '10px 8px' }}>
            <button
              onClick={() => toggleExpand(colab.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-3)', display: 'flex', alignItems: 'center',
                padding: 4, borderRadius: 4,
              }}
              title={expanded ? 'Recolher' : 'Expandir'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {expanded
                  ? <path d="M18 15l-6-6-6 6" />
                  : <path d="M6 9l6 6 6-6" />}
              </svg>
            </button>
          </td>
        </tr>
        {expanded && (
          <tr style={{ background: 'var(--surface-2)' }}>
            <td colSpan={5} style={{ ...tdStyle, borderTop: 'none', paddingTop: 0 }}>
              <div style={{ padding: '8px 4px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <BarraOcupacao horas={planN} height={12} />
                  <span style={{
                    fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: cor, whiteSpace: 'nowrap',
                  }}>
                    {Math.round((planN / TETO) * 100)}% de ocupação
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: `${cor}18`, color: cor, border: `1px solid ${cor}40`,
                  }}>
                    {TIER_INFO[colab.tier].label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{faixa}</span>
                </div>
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">

      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <Gauge size={20} style={{ color: 'var(--brand-500)' }} />
            Capacidade
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
            Ocupação da equipe no mês
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
      ) : semDados ? (
        <p style={{ fontSize: 14, color: 'var(--text-3)' }}>Nenhum colaborador alocado no período.</p>
      ) : (
        <div className="flex flex-col" style={{ gap: 16 }}>

          {/* ── KPIs ──────────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <KpiCard label="Headcount" value={headcount} />
            <KpiCard
              label="Sobrecarregados"
              value={sobrecarga}
              valueColor={sobrecarga > 0 ? '#ef4444' : 'var(--text-3)'}
            />
          </div>

          {/* ── Bloco de tiers: barra empilhada + chips ───────────────────── */}
          <div style={{
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '16px 20px',
          }}>
            <h2 style={{
              fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
            }}>
              Por Ocupação
            </h2>

            {/* Barra empilhada proporcional por tier */}
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
              {TIER_ORDER.map(tier => {
                const n = contPorTier[tier];
                if (n === 0) return null;
                return (
                  <div key={tier} style={{
                    width: `${(n / nTotal) * 100}%`,
                    background: TIER_INFO[tier].cor,
                    opacity: 0.9,
                  }} />
                );
              })}
            </div>

            {/* Chips: informativos para diretor, filtro clicável para os demais */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {TIER_ORDER.map(tier => {
                const count = contPorTier[tier];
                const ativo = tiersAtivos.has(tier);
                const { label, cor } = TIER_INFO[tier];
                if (isDiretor) {
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
                }
                return (
                  <button
                    key={tier}
                    onClick={() => toggleTier(tier)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                      border: `1px solid ${ativo ? cor : 'var(--border)'}`,
                      background: ativo ? `${cor}18` : 'var(--surface-2)',
                      transition: 'border-color 120ms, background 120ms',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                    <span style={{ color: ativo ? cor : 'var(--text-2)' }}>{label}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: ativo ? cor : 'var(--text-1)' }}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Tabela (oculta para diretor — regra absoluta) ─────────────── */}
          {!isDiretor && (
            <div style={{
              background: 'var(--surface-1)', border: '1px solid var(--border)',
              borderRadius: 10, overflow: 'hidden',
            }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th style={thStyle}>Colaborador</th>
                      <th style={thStyle}>Profissão</th>
                      <th style={{ ...thStyle, width: 260 }}>Planejado</th>
                      <th style={{ ...thStyle, width: 200 }}>Realizado</th>
                      <th style={{ ...thStyle, width: 36 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {listaFiltrada.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-3)', padding: '24px 12px' }}>
                          Nenhum colaborador neste filtro.
                        </td>
                      </tr>
                    ) : (
                      listaFiltrada.map(c => <LinhaColab key={c.id} colab={c} />)
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
