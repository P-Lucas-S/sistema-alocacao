import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useGestorFiltro } from '../context/GestorFiltroContext';
import { BarChart2, AlertTriangle, Settings, Pin, Pause, Play, ChevronDown } from 'lucide-react';
import SeletorMes from '../components/SeletorMes';
import SeletorGestor from '../components/SeletorGestor';

// ── Tipos ────────────────────────────────────────────────────────────────────

type CategoriaPrazo = 'alta' | 'media' | 'baixa' | 'sem_prazo';

interface ItemDashboard {
  projetoId:         string;
  codigo:            string;
  nome:              string;
  categoria:         CategoriaPrazo;
  proximaPrestacao:  string | null;
  diasAteVencimento: number | null;
  horasPendentes:    string;
  porque:            string;
  sinalCapacidade:   boolean;
  fixado:            boolean;
  pausado:           boolean;
  gestorId:          string | null;
  ordem:             number;
  tamanhoEquipe:     number;
  custoPlanejado:    string | null;
  horasPlanejadas:   string;
  horasRealizadas:   string | null;
  categoriaNome:     string | null;
  gestorNome:        string | null;
  custoRealizado:    string | null;
  qtdColabsGargalo:  number;
}

// ── Tipos de config ──────────────────────────────────────────────────────────

interface ConfigPriorizacao {
  prazoAltaDias:          number;
  prazoMediaDias:         number;
  tetoCapacidadeSinalPct: number;
  updatedBy:              { name: string } | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoeda(v: string): string {
  return parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// Único lugar onde a decisão null vs 0 em horas realizadas acontece.
function fmtRealizado(real: string | null, plan: string): {
  temRealizado: boolean; barPct: number; texto: string;
} {
  const planN = parseFloat(plan);
  const planStr = Number.isInteger(planN) ? `${planN}` : planN.toFixed(1);
  if (real === null) {
    return { temRealizado: false, barPct: 0, texto: `${planStr}h · —` };
  }
  const realN = parseFloat(real);
  const realStr = Number.isInteger(realN) ? `${realN}` : realN.toFixed(1);
  const pct = planN > 0 ? Math.round((realN / planN) * 100) : 0;
  return {
    temRealizado: true,
    barPct: planN > 0 ? Math.min((realN / planN) * 100, 100) : 0,
    texto: `${realStr}/${planStr}h · ${pct}%`,
  };
}

// ── Badge de categoria — dot colorido + label neutro (sem preenchimento) ────

const CAT_DOT: Record<CategoriaPrazo, { label: string; dot: string }> = {
  alta:      { label: 'Alta',      dot: '#ef4444' },
  media:     { label: 'Média',     dot: '#f59e0b' },
  baixa:     { label: 'Baixa',     dot: '#4ade80' },
  sem_prazo: { label: 'Sem prazo', dot: 'var(--text-2)' },
};

function BadgeCategoriaMudo({ cat }: { cat: CategoriaPrazo }) {
  const { label, dot } = CAT_DOT[cat] ?? CAT_DOT.sem_prazo;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{label}</span>
    </span>
  );
}

// ── Estilos de tabela ─────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  padding: '8px 12px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
  textAlign: 'left', whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px 12px', fontSize: 13, color: 'var(--text-1)',
  borderBottom: '1px solid var(--border)', verticalAlign: 'middle',
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function Prioridades() {
  const { token, user } = useAuth();
  const { gestorIdFiltro } = useGestorFiltro();

  const podeVerAcoes = user?.role === 'admin' || user?.role === 'chefe' || user?.role === 'gestor';
  const podeAgir = (item: ItemDashboard) =>
    user?.role === 'admin' || user?.role === 'chefe' ||
    (user?.role === 'gestor' && item.gestorId === user.id);

  const mostrarGestor = user?.role !== 'gestor';
  const podeEditar    = user?.role === 'admin' || user?.role === 'chefe';

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [itens,    setItens]    = useState<ItemDashboard[]>([]);
  const [pausados, setPausados] = useState<ItemDashboard[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [erro,     setErro]     = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [savingId, setSavingId] = useState<string | null>(null);

  // ── Expansão de linhas ────────────────────────────────────────────────────
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // ── Estado do modal de configuração ──────────────────────────────────────
  const [modalConfig,  setModalConfig]  = useState(false);
  const [cfg,          setCfg]          = useState<ConfigPriorizacao | null>(null);
  const [cfgLoading,   setCfgLoading]   = useState(false);
  const [fAlta,        setFAlta]        = useState('');
  const [fMedia,       setFMedia]       = useState('');
  const [fPct,         setFPct]         = useState('');
  const [cfgErro,      setCfgErro]      = useState('');
  const [cfgSalvando,  setCfgSalvando]  = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErro('');
      try {
        const qs = gestorIdFiltro
          ? `/api/dashboards/projetos?ano=${ano}&mes=${mes}&gestorId=${gestorIdFiltro}`
          : `/api/dashboards/projetos?ano=${ano}&mes=${mes}`;
        const res = await fetch(qs, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const d = await res.json();
          setItens(d.itens ?? []);
          setPausados(d.pausados ?? []);
        } else {
          const d = await res.json();
          setErro(d.error || 'Erro ao carregar o dashboard.');
        }
      } catch {
        setErro('Erro de rede.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token, ano, mes, refreshKey, gestorIdFiltro]);

  // ── Ação de fixar/pausar ─────────────────────────────────────────────────
  async function acaoPrioridade(projetoId: string, tipo: 'fixar' | 'desfixar' | 'pausar' | 'despausar') {
    setSavingId(projetoId);
    try {
      await fetch(`/api/priorizacao/${projetoId}/${tipo}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setRefreshKey(k => k + 1);
    } finally {
      setSavingId(null);
    }
  }

  const abrirConfig = useCallback(async () => {
    setModalConfig(true);
    setCfgErro('');
    setCfgLoading(true);
    try {
      const res = await fetch('/api/config/priorizacao', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d: ConfigPriorizacao = await res.json();
      setCfg(d);
      setFAlta(String(d.prazoAltaDias));
      setFMedia(String(d.prazoMediaDias));
      setFPct(String(d.tetoCapacidadeSinalPct));
    } catch {
      setCfgErro('Erro ao carregar configuração.');
    } finally {
      setCfgLoading(false);
    }
  }, [token]);

  async function salvarConfig() {
    const alta  = parseInt(fAlta);
    const media = parseInt(fMedia);
    const pct   = parseInt(fPct);

    if (!Number.isInteger(alta) || alta < 1) {
      setCfgErro('Faixa Alta deve ser um número inteiro >= 1.');
      return;
    }
    if (!Number.isInteger(media) || media <= alta) {
      setCfgErro(`Faixa Média deve ser maior que Alta (> ${alta}).`);
      return;
    }
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      setCfgErro('Percentual de capacidade deve estar entre 1 e 100.');
      return;
    }

    setCfgErro('');
    setCfgSalvando(true);
    try {
      const res = await fetch('/api/config/priorizacao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prazoAltaDias: alta, prazoMediaDias: media, tetoCapacidadeSinalPct: pct }),
      });
      const d = await res.json();
      if (!res.ok) {
        setCfgErro(d.error || 'Erro ao salvar.');
        return;
      }
      setCfg(d);
      setModalConfig(false);
      setRefreshKey(k => k + 1);
    } catch {
      setCfgErro('Erro de rede ao salvar.');
    } finally {
      setCfgSalvando(false);
    }
  }

  // ── Linha da tabela ───────────────────────────────────────────────────────
  function LinhaTabela({ item, dimmed }: { item: ItemDashboard; dimmed?: boolean }) {
    const isSaving   = savingId === item.projetoId;
    const agir       = podeAgir(item);
    const isExpanded = expandedIds.has(item.projetoId);
    const isVencida  = item.diasAteVencimento !== null && item.diasAteVencimento < 0;
    const exec       = fmtRealizado(item.horasRealizadas, item.horasPlanejadas);
    // 8 colunas fixas (CAT, PROJ, PRESTAÇÃO, EXEC, CUSTO, EQUIPE, EXPANSÃO)
    // + GESTOR condicional + AÇÕES condicional
    const numCols = 7 + (mostrarGestor ? 1 : 0) + (podeVerAcoes ? 1 : 0);

    return (
      <>
        <tr
          className="hover:bg-[var(--surface-3)] transition-colors duration-100"
          style={{ opacity: dimmed ? 0.6 : 1 }}
        >
          {/* CATEGORIA — dot badge mudo. Borda esquerda 3px só para vencida; transparente preserva o alinhamento. */}
          <td style={{ ...td, borderLeft: isVencida ? '3px solid #ef4444' : '3px solid transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BadgeCategoriaMudo cat={item.categoria} />
              {item.fixado && (
                <Pin size={11} fill="var(--brand-500)" style={{ color: 'var(--brand-500)', flexShrink: 0 }} />
              )}
            </div>
          </td>

          {/* PROJETO — nome principal + código muted abaixo */}
          <td style={td}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                {item.nome}
              </span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-2)' }}>
                {item.codigo}
              </span>
            </div>
          </td>

          {/* GESTOR (oculto para papel gestor) */}
          {mostrarGestor && (
            <td style={{ ...td, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {item.gestorNome ?? '—'}
              </span>
            </td>
          )}

          {/* PRESTAÇÃO — vencida: vermelho + ícone; alta: negrito; sem data: travessão */}
          <td style={{ ...td, whiteSpace: 'nowrap' }}>
            {item.proximaPrestacao ? (
              isVencida ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ef4444', fontWeight: 600 }}>
                  <AlertTriangle size={12} />
                  {fmtDate(item.proximaPrestacao)}
                </span>
              ) : item.categoria === 'alta' ? (
                <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>
                  {fmtDate(item.proximaPrestacao)}
                </span>
              ) : (
                <span style={{ color: 'var(--text-1)' }}>
                  {fmtDate(item.proximaPrestacao)}
                </span>
              )
            ) : (
              <span style={{ color: 'var(--text-3)' }}>—</span>
            )}
          </td>

          {/* EXECUÇÃO — mini-barra + "312/480h · 65%". Contorno vazio quando sem realizado. */}
          <td style={{ ...td, whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{
                width: 60, height: 4, borderRadius: 2,
                background: exec.temRealizado ? 'hsl(0 0% 50% / 0.15)' : 'transparent',
                border: exec.temRealizado ? 'none' : '1.5px solid var(--border-strong)',
                position: 'relative', overflow: 'hidden',
              }}>
                {exec.temRealizado && (
                  <div style={{
                    position: 'absolute', inset: '0 auto 0 0',
                    width: `${exec.barPct}%`,
                    background: exec.barPct >= 100 ? '#4ade80' : 'var(--brand-500)',
                    borderRadius: 2,
                  }} />
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                {exec.texto}
              </span>
            </div>
          </td>

          {/* CUSTO — planejado primary, realizado muted abaixo */}
          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
              <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {item.custoPlanejado != null
                  ? fmtMoeda(item.custoPlanejado)
                  : <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>—</span>
                }
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                {item.custoRealizado != null ? fmtMoeda(item.custoRealizado) : '—'}
              </span>
            </div>
          </td>

          {/* EQUIPE — tamanho · gargalo⚠ (⚠ some quando zero) */}
          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-1)' }}>
              {item.tamanhoEquipe > 0 ? item.tamanhoEquipe : '—'}
              {item.qtdColabsGargalo > 0 && (
                <span
                  title={`${item.qtdColabsGargalo} colaborador(es) no limite de capacidade`}
                  style={{ color: '#f59e0b', marginLeft: 4 }}
                >
                  {' · '}{item.qtdColabsGargalo}
                  <AlertTriangle size={11} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} />
                </span>
              )}
            </span>
          </td>

          {/* EXPANSÃO */}
          <td style={{ ...td, padding: '4px 8px', width: 36 }}>
            <button
              onClick={() => toggleExpand(item.projetoId)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6,
                border: '1px solid transparent',
                background: 'transparent',
                color: 'var(--text-2)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <ChevronDown
                size={14}
                style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms' }}
              />
            </button>
          </td>

          {/* AÇÕES */}
          {podeVerAcoes && (
            <td style={{ ...td, textAlign: 'right', paddingRight: 8 }}>
              {agir && (
                <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                  <button
                    disabled={isSaving}
                    onClick={() => acaoPrioridade(item.projetoId, item.fixado ? 'desfixar' : 'fixar')}
                    title={item.fixado ? 'Desfixar (volta à ordem natural)' : 'Fixar no topo da categoria'}
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      color: item.fixado ? 'var(--brand-500)' : 'var(--text-3)',
                      background: item.fixado ? 'hsl(221 83% 53% / 0.1)' : 'transparent',
                      border: item.fixado ? '1px solid hsl(221 83% 53% / 0.25)' : '1px solid transparent',
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                      opacity: isSaving ? 0.5 : 1,
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => { if (!isSaving && !item.fixado) (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'; }}
                    onMouseLeave={e => { if (!item.fixado) (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
                  >
                    <Pin size={13} fill={item.fixado ? 'var(--brand-500)' : 'none'} />
                  </button>

                  <button
                    disabled={isSaving}
                    onClick={() => acaoPrioridade(item.projetoId, item.pausado ? 'despausar' : 'pausar')}
                    title={item.pausado ? 'Retomar (volta à fila)' : 'Pausar (retira da fila)'}
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      color: item.pausado ? '#f59e0b' : 'var(--text-3)',
                      background: item.pausado ? 'hsl(38 95% 55% / 0.1)' : 'transparent',
                      border: item.pausado ? '1px solid hsl(38 95% 55% / 0.25)' : '1px solid transparent',
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                      opacity: isSaving ? 0.5 : 1,
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => { if (!isSaving && !item.pausado) (e.currentTarget as HTMLElement).style.color = '#f59e0b'; }}
                    onMouseLeave={e => { if (!item.pausado) (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
                  >
                    {item.pausado ? <Play size={13} /> : <Pause size={13} />}
                  </button>
                </div>
              )}
            </td>
          )}
        </tr>

        {/* Linha de expansão — Programa de fomento + Por quê */}
        {isExpanded && (
          <tr style={{ background: 'var(--surface-2)' }}>
            <td
              colSpan={numCols}
              style={{ padding: '8px 16px 12px 20px', borderBottom: '1px solid var(--border)' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {item.porque && (
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>
                      Por quê está na fila
                    </span>
                    <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-2)' }}>{item.porque}</p>
                  </div>
                )}
                {item.categoriaNome && (
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>
                      Programa de fomento
                    </span>
                    <p style={{ margin: '3px 0 0' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'hsl(221 83% 53% / 0.12)', color: 'var(--brand-500)' }}>
                        {item.categoriaNome}
                      </span>
                    </p>
                  </div>
                )}
                {!item.porque && !item.categoriaNome && (
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Sem informações adicionais.</span>
                )}
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  // ── Cabeçalho da tabela ──────────────────────────────────────────────────
  function THead() {
    return (
      <thead>
        <tr>
          <th style={{ ...th, paddingLeft: 12 }}>Categoria</th>
          <th style={th}>Projeto</th>
          {mostrarGestor && <th style={th}>Gestor</th>}
          <th style={th}>Prestação</th>
          <th style={th}>Execução</th>
          <th style={{ ...th, textAlign: 'right' }}>Custo</th>
          <th style={{ ...th, textAlign: 'right' }}>Equipe</th>
          <th style={{ ...th, width: 36 }}></th>
          {podeVerAcoes && <th style={{ ...th, textAlign: 'right', width: 68 }}></th>}
        </tr>
      </thead>
    );
  }

  const semNada = itens.length === 0 && pausados.length === 0;

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <BarChart2 size={20} style={{ color: 'var(--brand-500)' }} />
              Prioridades
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
              Acompanhamento de projetos por prazo de prestação de contas
            </p>
          </div>
          {podeEditar && (
            <button
              onClick={abrirConfig}
              title="Configurar limiares de priorização"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text-3)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Settings size={15} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SeletorMes mes={mes} ano={ano} onMes={setMes} onAno={setAno} />
          <SeletorGestor />
        </div>
      </div>

      {/* Conteúdo */}
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
      ) : semNada ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 pt-16" style={{ color: 'var(--text-3)' }}>
          <BarChart2 size={40} strokeWidth={1} />
          <p className="text-sm">Nenhum projeto ativo no escopo deste mês.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* ── Fila ativa ───────────────────────────────────────────────── */}
          {itens.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                <THead />
                <tbody>
                  {itens.map(item => <LinhaTabela key={item.projetoId} item={item} />)}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Seção pausados ───────────────────────────────────────────── */}
          {pausados.length > 0 && (
            <div>
              <div
                className="flex items-center gap-2 mb-3"
                style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)' }}
              >
                <Pause size={14} style={{ color: 'var(--text-3)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)' }}>
                  Pausados ({pausados.length})
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  — fora da fila de priorização
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                  <THead />
                  <tbody>
                    {pausados.map(item => <LinhaTabela key={item.projetoId} item={item} dimmed />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de configuração dos limiares */}
      {modalConfig && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { if (!cfgSalvando) setModalConfig(false); }}
        >
          <div
            style={{ background: 'var(--surface-1)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: '20px 24px', width: 440, maxWidth: '92vw' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 4px' }}>
              Configurar priorização
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 18px' }}>
              Define as faixas de prazo e o sinal de capacidade. Efetivo imediatamente para todos.
            </p>

            {cfgLoading ? (
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>Carregando…</p>
            ) : (
              <>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', margin: '0 0 10px' }}>
                  Categorias de prazo
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                      🔴 Alta — vencida ou vence em até
                      {' '}<input
                        type="number" min={1} step={1} value={fAlta}
                        onChange={e => { setFAlta(e.target.value); setCfgErro(''); }}
                        disabled={cfgSalvando}
                        style={{ width: 52, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13, textAlign: 'center' }}
                      />{' '}dias
                    </span>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                      🟡 Média — vence em até
                      {' '}<input
                        type="number" min={2} step={1} value={fMedia}
                        onChange={e => { setFMedia(e.target.value); setCfgErro(''); }}
                        disabled={cfgSalvando}
                        style={{ width: 52, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13, textAlign: 'center' }}
                      />{' '}dias
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', paddingLeft: 2 }}>
                      A faixa Média vai do dia {(parseInt(fAlta) || 0) + 1} até este limite. Acima → Baixa.
                    </span>
                  </label>
                </div>

                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', margin: '0 0 10px' }}>
                  Sinal de capacidade (⚠)
                </p>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 18 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                    Alertar quando a equipe atingir
                    {' '}<input
                      type="number" min={1} max={100} step={1} value={fPct}
                      onChange={e => { setFPct(e.target.value); setCfgErro(''); }}
                      disabled={cfgSalvando}
                      style={{ width: 48, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13, textAlign: 'center' }}
                    />% do teto mensal (220h)
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', paddingLeft: 2 }}>
                    Exibe ⚠ no projeto se algum colaborador atingir esse percentual no mês.
                  </span>
                </label>

                {cfg?.updatedBy && (
                  <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 14px' }}>
                    Última edição por <strong>{cfg.updatedBy.name}</strong>.
                  </p>
                )}

                {cfgErro && (
                  <p style={{ fontSize: 12, color: '#b42318', margin: '0 0 12px' }}>{cfgErro}</p>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => setModalConfig(false)}
                    disabled={cfgSalvando}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={salvarConfig}
                    disabled={cfgSalvando}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: 'var(--brand-500)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: cfgSalvando ? 'not-allowed' : 'pointer', opacity: cfgSalvando ? 0.6 : 1 }}
                  >
                    {cfgSalvando ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
