import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useGestorFiltro } from '../context/GestorFiltroContext';
import { BarChart2, AlertTriangle, Settings } from 'lucide-react';
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
  ordem:             number;
  tamanhoEquipe:     number;
  custoPlanejado:    string | null;
  horasPlanejadas:   string;
  horasRealizadas:   string | null; // null = sem nenhum apontamento no mês
  // campos do dashboard completo
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

function fmtHoras(h: string): string {
  const n = parseFloat(h);
  return Number.isInteger(n) ? `${n}h` : `${n.toFixed(1)}h`;
}

// timeZone:'UTC' garante que "2026-12-31T00:00:00.000Z" mostre "31/12/2026", não "30/12/2026"
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// ── Badge de categoria ────────────────────────────────────────────────────────

const CATEGORIA: Record<CategoriaPrazo, { label: string; bg: string; color: string }> = {
  alta:      { label: 'Alta',      bg: 'hsl(0 85% 60% / 0.15)',    color: '#ef4444' },
  media:     { label: 'Média',     bg: 'hsl(38 95% 55% / 0.15)',   color: '#f59e0b' },
  baixa:     { label: 'Baixa',     bg: 'hsl(142 71% 45% / 0.12)', color: '#4ade80' },
  sem_prazo: { label: 'Sem prazo', bg: 'hsl(0 0% 50% / 0.12)',     color: 'var(--text-3)' },
};

function BadgeCategoria({ cat }: { cat: CategoriaPrazo }) {
  const { label, bg, color } = CATEGORIA[cat] ?? CATEGORIA.sem_prazo;
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

// ── Estilos de tabela (mesmo padrão de Custos.tsx) ───────────────────────────

const th: React.CSSProperties = {
  padding: '8px 12px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
  textAlign: 'left', whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px 12px', fontSize: 13, color: 'var(--text-1)',
  borderBottom: '1px solid var(--border)', verticalAlign: 'top',
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function Prioridades() {
  const { token, user } = useAuth();
  const { gestorIdFiltro } = useGestorFiltro();
  const podeEditar    = user?.role === 'admin' || user?.role === 'chefe';
  const mostrarGestor = user?.role !== 'gestor';

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [itens, setItens]     = useState<ItemDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

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
          setItens(await res.json());
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
    const alta = parseInt(fAlta);
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
      ) : itens.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 pt-16" style={{ color: 'var(--text-3)' }}>
          <BarChart2 size={40} strokeWidth={1} />
          <p className="text-sm">Nenhum projeto ativo no escopo deste mês.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1380 }}>
            <thead>
              <tr>
                <th style={th}>Prioridade</th>
                <th style={th}>Projeto</th>
                <th style={th}>Por quê</th>
                <th style={th}>Próx. prestação</th>
                <th style={th}>Programa</th>
                {mostrarGestor && <th style={th}>Gestor</th>}
                <th style={{ ...th, textAlign: 'right' }}>Planejadas</th>
                <th style={{ ...th, textAlign: 'right' }}>Realizadas</th>
                <th style={{ ...th, textAlign: 'right' }}>% Exec.</th>
                <th style={{ ...th, textAlign: 'right' }}>Custo plan.</th>
                <th style={{ ...th, textAlign: 'right' }}>Custo real.</th>
                <th style={{ ...th, textAlign: 'right' }}>Equipe</th>
                <th style={{ ...th, textAlign: 'center' }}>Gargalo</th>
              </tr>
            </thead>
            <tbody>
              {itens.map(item => (
                <tr key={item.projetoId} className="hover:bg-[var(--surface-3)] transition-colors duration-100">
                  {/* Badge categoria */}
                  <td style={td}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono" style={{ color: 'var(--text-3)', minWidth: 16 }}>
                        {item.ordem}
                      </span>
                      <BadgeCategoria cat={item.categoria} />
                    </div>
                  </td>

                  {/* Código + Nome */}
                  <td style={td}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-bold font-mono" style={{ color: 'var(--brand-500)' }}>
                        {item.codigo}
                      </span>
                      <span className="text-sm" style={{ color: 'var(--text-1)' }}>
                        {item.nome}
                      </span>
                    </div>
                  </td>

                  {/* Por quê */}
                  <td style={{ ...td, maxWidth: 260 }}>
                    <span className="text-sm" style={{ color: 'var(--text-2)' }}>
                      {item.porque}
                    </span>
                  </td>

                  {/* Próxima prestação */}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {item.proximaPrestacao
                      ? <span style={{ color: item.categoria === 'alta' ? '#ef4444' : 'var(--text-1)' }}>
                          {fmtDate(item.proximaPrestacao)}
                        </span>
                      : <span style={{ color: 'var(--text-3)' }}>—</span>
                    }
                  </td>

                  {/* Programa de fomento */}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {item.categoriaNome
                      ? <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: 'hsl(221 83% 53% / 0.12)', color: 'var(--brand-500)' }}
                        >
                          {item.categoriaNome}
                        </span>
                      : <span style={{ color: 'var(--text-3)' }}>—</span>
                    }
                  </td>

                  {/* Gestor (oculto para papel gestor) */}
                  {mostrarGestor && (
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                        {item.gestorNome ?? '—'}
                      </span>
                    </td>
                  )}

                  {/* Horas planejadas */}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {parseFloat(item.horasPlanejadas) > 0
                      ? fmtHoras(item.horasPlanejadas)
                      : <span style={{ color: 'var(--text-3)' }}>—</span>
                    }
                  </td>

                  {/* Horas realizadas — "sem apontamento" quando null/ausente */}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {item.horasRealizadas != null
                      ? fmtHoras(item.horasRealizadas)
                      : <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>sem apontamento</span>
                    }
                  </td>

                  {/* % Execução — N/D quando sem apontamento (ausência ≠ 0%) */}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {(() => {
                      const real = item.horasRealizadas != null ? parseFloat(item.horasRealizadas) : null;
                      if (real == null || real === 0) {
                        return <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>N/D</span>;
                      }
                      const plan = parseFloat(item.horasPlanejadas);
                      const pct  = plan > 0 ? Math.round((real / plan) * 100) : 100;
                      return (
                        <span style={{ fontWeight: 600, color: pct >= 100 ? '#4ade80' : 'var(--text-1)' }}>
                          {pct}%
                        </span>
                      );
                    })()}
                  </td>

                  {/* Custo planejado */}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {item.custoPlanejado != null
                      ? fmtMoeda(item.custoPlanejado)
                      : <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>—</span>
                    }
                  </td>

                  {/* Custo realizado */}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {item.custoRealizado != null
                      ? fmtMoeda(item.custoRealizado)
                      : <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>—</span>
                    }
                  </td>

                  {/* Tamanho da equipe */}
                  <td style={{ ...td, textAlign: 'right' }}>
                    {item.tamanhoEquipe > 0
                      ? item.tamanhoEquipe
                      : <span style={{ color: 'var(--text-3)' }}>—</span>
                    }
                  </td>

                  {/* Gargalo — nº de colaboradores ≥ limiar de capacidade */}
                  <td style={{ ...td, textAlign: 'center' }}>
                    {item.qtdColabsGargalo > 0 && (
                      <span
                        title={`${item.qtdColabsGargalo} colaborador(es) no limite de capacidade`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#f59e0b' }}
                      >
                        <AlertTriangle size={13} />
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{item.qtdColabsGargalo}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                {/* Bloco: faixas de prazo */}
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

                {/* Bloco: sinal de capacidade */}
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

                {/* Quem editou por último */}
                {cfg?.updatedBy && (
                  <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 14px' }}>
                    Última edição por <strong>{cfg.updatedBy.name}</strong>.
                  </p>
                )}

                {/* Erro */}
                {cfgErro && (
                  <p style={{ fontSize: 12, color: '#b42318', margin: '0 0 12px' }}>{cfgErro}</p>
                )}

                {/* Botões */}
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
