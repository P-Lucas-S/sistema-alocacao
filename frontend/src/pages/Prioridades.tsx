import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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

interface CategoriaAgg {
  categoria: CategoriaPrazo;
  count:     number;
  custo:     string;
}

// Payload do diretor: SÓ agregados — nunca nomes de projeto/gestor
// (fase A-meio da auditoria, item 7).
interface DiretorAgg {
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

// Ordem canônica dos chips — preserva consistência visual com a tabela
const CATS: CategoriaPrazo[] = ['alta', 'media', 'baixa', 'sem_prazo'];

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
  const [searchParams] = useSearchParams();

  const podeVerAcoes = user?.role === 'admin' || user?.role === 'chefe' || user?.role === 'gestor';
  const podeAgir = (item: ItemDashboard) =>
    user?.role === 'admin' || user?.role === 'chefe' ||
    (user?.role === 'gestor' && item.gestorId === user.id);

  const mostrarGestor = user?.role !== 'gestor';
  const podeEditar    = user?.role === 'admin' || user?.role === 'chefe';
  const isDiretor     = user?.role === 'diretor';

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [itens,    setItens]    = useState<ItemDashboard[]>([]);
  const [pausados, setPausados] = useState<ItemDashboard[]>([]);
  const [diretorAgg, setDiretorAgg] = useState<DiretorAgg | null>(null);
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

  // ── Chips de categoria — toggle combinável (OR); pré-ativo via ?categoria= ──
  const [chipsFiltro, setChipsFiltro] = useState<Set<CategoriaPrazo>>(() => {
    const cat = searchParams.get('categoria') as CategoriaPrazo | null;
    return cat && CATS.includes(cat) ? new Set([cat]) : new Set();
  });
  const toggleChip = (cat: CategoriaPrazo) =>
    setChipsFiltro(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });

  // ── Nome do gestor quando "ver como" está ativo ───────────────────────────
  const [gestorNomeVis, setGestorNomeVis] = useState<string | null>(null);

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
          if (isDiretor) {
            setDiretorAgg(d);
            setItens([]);
            setPausados([]);
          } else {
            setItens(d.itens ?? []);
            setPausados(d.pausados ?? []);
          }
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
  }, [token, ano, mes, refreshKey, gestorIdFiltro, isDiretor]);

  // Carrega config no mount — prazoAltaDias precisa estar disponível para a
  // FaixaVeredito sem depender de o usuário abrir o modal de configuração.
  useEffect(() => {
    if (!token) return;
    fetch('/api/config/priorizacao', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((d: ConfigPriorizacao | null) => {
        if (!d) return;
        setCfg(d);
        setFAlta(String(d.prazoAltaDias));
        setFMedia(String(d.prazoMediaDias));
        setFPct(String(d.tetoCapacidadeSinalPct));
      })
      .catch(() => {});
  }, [token]);

  // Atualiza nome do gestor visível para o label de escopo. Diretor recebe o
  // gestorNome pronto do backend (payload sem listas); os demais derivam do
  // primeiro item das listas, como antes.
  useEffect(() => {
    if (!gestorIdFiltro) { setGestorNomeVis(null); return; }
    const nome = isDiretor
      ? diretorAgg?.gestorNome ?? null
      : itens[0]?.gestorNome ?? pausados[0]?.gestorNome ?? null;
    if (nome) setGestorNomeVis(nome);
  }, [gestorIdFiltro, itens, pausados, isDiretor, diretorAgg]);

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

  // ── Derivados (spec 4.1): todos = escopo completo, ignora chipsFiltro ───────
  // Diretor: agregados prontos do backend (payload sem itens/pausados).
  // Demais papéis: derivam de itens+pausados, como sempre.
  const todos     = [...itens, ...pausados];
  const altaDias  = cfg?.prazoAltaDias ?? 7;

  const contagensPorCategoria: Record<CategoriaPrazo, number> = isDiretor
    ? {
        alta:      diretorAgg?.custoPorCategoria.find(c => c.categoria === 'alta')?.count ?? 0,
        media:     diretorAgg?.custoPorCategoria.find(c => c.categoria === 'media')?.count ?? 0,
        baixa:     diretorAgg?.custoPorCategoria.find(c => c.categoria === 'baixa')?.count ?? 0,
        sem_prazo: diretorAgg?.custoPorCategoria.find(c => c.categoria === 'sem_prazo')?.count ?? 0,
      }
    : {
        alta:      todos.filter(x => x.categoria === 'alta').length,
        media:     todos.filter(x => x.categoria === 'media').length,
        baixa:     todos.filter(x => x.categoria === 'baixa').length,
        sem_prazo: todos.filter(x => x.categoria === 'sem_prazo').length,
      };

  const nTotal    = isDiretor ? (diretorAgg?.nTotal ?? 0) : todos.length;
  const nAlta     = contagensPorCategoria.alta;
  // nPrestac: prestações próximas mas ainda não vencidas (upcoming ≤ altaDias)
  const nPrestac  = isDiretor
    ? diretorAgg?.nPrestac ?? 0
    : todos.filter(x =>
        x.diasAteVencimento !== null && x.diasAteVencimento >= 0 && x.diasAteVencimento <= altaDias
      ).length;
  const nSemApon  = isDiretor
    ? diretorAgg?.nSemApon ?? 0
    : todos.filter(x => x.horasRealizadas === null).length;
  const totalPlan = isDiretor
    ? parseFloat(diretorAgg?.totalPlan ?? '0')
    : todos.reduce((s, x) => s + (x.custoPlanejado ? parseFloat(x.custoPlanejado) : 0), 0);

  const custoPorCategoria = isDiretor
    ? (diretorAgg?.custoPorCategoria ?? [])
        .map(c => ({ cat: c.categoria, count: c.count, custo: parseFloat(c.custo) }))
        .filter(c => c.count > 0)
    : CATS.map(cat => {
        const itensCateg = todos.filter(x => x.categoria === cat);
        const count = itensCateg.length;
        const custo = itensCateg.reduce((s, x) => s + (x.custoPlanejado ? parseFloat(x.custoPlanejado) : 0), 0);
        return { cat, count, custo };
      }).filter(c => c.count > 0);

  // Itens filtrados pelos chips ativos (vazio = sem filtro = mostra todos)
  const itensFiltrados    = chipsFiltro.size === 0 ? itens    : itens.filter(x => chipsFiltro.has(x.categoria));
  const pausadosFiltrados = chipsFiltro.size === 0 ? pausados : pausados.filter(x => chipsFiltro.has(x.categoria));

  // Escopo (spec 2.6)
  const escopoLabel = gestorIdFiltro
    ? `visualizando como ${gestorNomeVis ?? '…'}`
    : user?.role === 'gestor'
      ? `seus ${nTotal} projetos`
      : 'todos os gestores';

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

  const semNada = isDiretor ? nTotal === 0 : itens.length === 0 && pausados.length === 0;

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
          {!loading && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
              Escopo: {escopoLabel}
            </span>
          )}
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
      ) : (
        <div className="flex flex-col" style={{ gap: 12 }}>

          {/* ── Faixa de veredito (spec 4.1) — sempre visível, ignora chipsFiltro ── */}
          <div style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 14px',
            padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
          }}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              <b style={{ color: 'var(--text-1)' }}>{nTotal}</b>{' '}
              <span style={{ color: 'var(--text-3)' }}>projetos</span>
            </span>

            <span style={{ color: 'var(--border-strong)' }}>·</span>

            <span style={{ fontVariantNumeric: 'tabular-nums', color: nAlta > 0 ? '#ef4444' : 'var(--text-3)' }}>
              <b>{nAlta}</b>{' '}em Alta
            </span>

            <span style={{ color: 'var(--border-strong)' }}>·</span>

            <span style={{ fontVariantNumeric: 'tabular-nums', color: nPrestac > 0 ? '#ef4444' : 'var(--text-3)' }}>
              <b>{nPrestac}</b>{' '}prestações ≤{altaDias}d
            </span>

            <span style={{ color: 'var(--border-strong)' }}>·</span>

            <span style={{ fontVariantNumeric: 'tabular-nums', color: nSemApon > 0 ? 'var(--text-1)' : 'var(--text-3)' }}>
              <b>{nSemApon}</b>{' '}sem apontamento
            </span>

            <span style={{ color: 'var(--border-strong)' }}>·</span>

            <span style={{ fontVariantNumeric: 'tabular-nums', color: totalPlan > 0 ? 'var(--text-2)' : 'var(--text-3)' }}>
              {totalPlan > 0
                ? totalPlan.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
                : 'R$ —'}
            </span>
          </div>

          {/* ── Chips de categoria — toggle para demais papéis; texto plano para diretor ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {CATS.map(cat => {
              const { label, dot } = CAT_DOT[cat];
              const count   = contagensPorCategoria[cat];
              const ativo   = chipsFiltro.has(cat);
              const isCssVar = dot.startsWith('var(');
              if (isDiretor) {
                return (
                  <span key={cat} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 20, fontSize: 12,
                    border: '1px solid var(--border)', background: 'transparent',
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: isCssVar ? 'var(--text-2)' : dot, flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-2)' }}>{label}</span>
                    <span style={{ marginLeft: 2, fontVariantNumeric: 'tabular-nums', color: 'var(--text-3)' }}>{count}</span>
                  </span>
                );
              }
              return (
                <button
                  key={cat}
                  onClick={() => toggleChip(cat)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                    fontSize: 12,
                    border: ativo
                      ? (isCssVar ? '1px solid var(--border-strong)' : `1px solid ${dot}99`)
                      : '1px solid var(--border)',
                    background: ativo
                      ? (isCssVar ? 'var(--surface-3)' : `${dot}18`)
                      : 'transparent',
                    transition: 'border-color 120ms, background 120ms',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-2)' }}>{label}</span>
                  <span style={{
                    marginLeft: 2, fontVariantNumeric: 'tabular-nums',
                    color: ativo ? 'var(--text-1)' : 'var(--text-3)',
                    fontWeight: ativo ? 600 : 400,
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
            {!isDiretor && chipsFiltro.size > 0 && (
              <button
                onClick={() => setChipsFiltro(new Set())}
                style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
              >
                Limpar filtro
              </button>
            )}
          </div>

          {/* ── Vista diretor: custo agregado por categoria, sem tabela, sem nomes ── */}
          {isDiretor ? (
            semNada ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-2 pt-16" style={{ color: 'var(--text-3)' }}>
                <BarChart2 size={40} strokeWidth={1} />
                <p className="text-sm">Nenhum projeto ativo no escopo deste mês.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
                {custoPorCategoria.map(({ cat, count, custo }) => {
                  const { label, dot } = CAT_DOT[cat];
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
            )
          ) : (
            /* ── Tabelas (filtradas pelos chips) para demais papéis ──────── */
            semNada ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-2 pt-16" style={{ color: 'var(--text-3)' }}>
                <BarChart2 size={40} strokeWidth={1} />
                <p className="text-sm">Nenhum projeto ativo no escopo deste mês.</p>
              </div>
            ) : itensFiltrados.length === 0 && pausadosFiltrados.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '24px 0' }}>
                Nenhum projeto nas categorias selecionadas.
              </p>
            ) : (
              <div className="flex flex-col gap-8">
                {/* ── Fila ativa */}
                {itensFiltrados.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                      <THead />
                      <tbody>
                        {itensFiltrados.map(item => <LinhaTabela key={item.projetoId} item={item} />)}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ── Seção pausados */}
                {pausadosFiltrados.length > 0 && (
                  <div>
                    <div
                      className="flex items-center gap-2 mb-3"
                      style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)' }}
                    >
                      <Pause size={14} style={{ color: 'var(--text-3)' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)' }}>
                        Pausados ({pausadosFiltrados.length})
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        — fora da fila de priorização
                      </span>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                        <THead />
                        <tbody>
                          {pausadosFiltrados.map(item => <LinhaTabela key={item.projetoId} item={item} dimmed />)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
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
