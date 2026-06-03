import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { LayoutGrid, ChevronLeft, ChevronRight } from 'lucide-react';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface ProjetoCol {
  id: string;
  codigo: string;
  nome: string;
  gestorId: string;
}

interface Celula {
  id: string;
  horasPlanejadas: string;
  macroEntregaId: string;
  microEntregaId: string;
}

interface Saldo {
  totalMeusProj: string;
  totalOutros:   string;
  totalGeral:    string;
  disponivel:    string;
}

interface Linha {
  colaborador: { id: string; nome: string; funcao: string | null };
  saldo: Saldo;
  celulas: Record<string, Celula | null>;
}

interface GridData {
  projetos: ProjetoCol[];
  linhas:   Linha[];
}

// ── Constantes ───────────────────────────────────────────────────────────────

const TETO = 220;

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Larguras das colunas fixas (sticky)
const COL_COLAB_W  = 200;
const COL_SALDO_W  = 260;
const COL_PROJ_W   = 130;

// ── Helpers ──────────────────────────────────────────────────────────────────

function corSaldo(pct: number): string {
  if (pct >= 100) return '#ef4444'; // vermelho
  if (pct >= 80)  return '#f59e0b'; // âmbar
  return '#22c55e';                 // verde
}

function fmtHoras(h: string | number): string {
  const n = parseFloat(String(h));
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

// ── Barra de saldo ───────────────────────────────────────────────────────────
//
// Regra de leitura:
//   COR  → lotação total do colaborador (verde/âmbar/vermelho). Mesma cor em
//           ambos os segmentos — a lotação não depende de quem alocou.
//   TEXTURA → sólido = minhas horas (editáveis); hachurado = outros gestores
//              (só-leitura). Ambos somam visualmente à ocupação total.
//   FUNDO → var(--surface-3) inequivocamente vazio; não deve ser confundido
//            com ocupação.

function BarraSaldo({ saldo }: { saldo: Saldo }) {
  const totalG = parseFloat(saldo.totalGeral);
  const meus   = parseFloat(saldo.totalMeusProj);
  const outros = parseFloat(saldo.totalOutros);
  const disp   = parseFloat(saldo.disponivel);

  const pctTotal  = Math.min((totalG / TETO) * 100, 100);
  const pctMeus   = Math.min((meus   / TETO) * 100, pctTotal);
  const pctOutros = Math.min((outros / TETO) * 100, Math.max(0, pctTotal - pctMeus));

  // Cor reflete APENAS a lotação total — não quem alocou
  const cor = corSaldo((totalG / TETO) * 100);

  // Hatch na mesma cor de status: distingue por textura, não por cor diferente
  const hatch = `repeating-linear-gradient(
    45deg,
    ${cor},
    ${cor} 3px,
    transparent 3px,
    transparent 8px
  )`;

  const tooltip = `Você: ${fmtHoras(meus)}h · Outros: ${fmtHoras(outros)}h · Disponível: ${fmtHoras(disp)}h`;

  return (
    <div className="flex items-center gap-2 min-w-0 w-full" title={tooltip}>
      {/* Barra — overflow:hidden + border-radius recortam os filhos */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: 8,
          borderRadius: 9999,
          overflow: 'hidden',
          background: 'var(--surface-3)',  // espaço livre: inequivocamente vazio
          minWidth: 80,
        }}
      >
        {/* Outros gestores: hachurado, mesma cor de status */}
        {pctOutros > 0 && (
          <div
            style={{
              position: 'absolute',
              left: `${pctMeus}%`,
              width: `${pctOutros}%`,
              height: '100%',
              background: hatch,
            }}
          />
        )}
        {/* Minhas horas: sólido, cor de status — desenhado por cima do hatch */}
        {pctMeus > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              width: `${pctMeus}%`,
              height: '100%',
              background: cor,
            }}
          />
        )}
      </div>
      {/* Texto na cor de status */}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          color: cor,
          minWidth: 56,
          textAlign: 'right',
        }}
      >
        {fmtHoras(saldo.totalGeral)}/{TETO}h
      </span>
    </div>
  );
}

// ── Célula (read-only em D1) ──────────────────────────────────────────────────

function CelulaGrid({ celula }: { celula: Celula | null }) {
  const base: React.CSSProperties = {
    width: COL_PROJ_W,
    minWidth: COL_PROJ_W,
    padding: '6px 12px',
    textAlign: 'center',
    borderRight: '1px solid var(--border)',
    verticalAlign: 'middle',
  };

  if (!celula) {
    return (
      <td style={base}>
        <span style={{ color: 'var(--text-3)', fontSize: 13 }}>—</span>
      </td>
    );
  }

  return (
    <td style={base}>
      {/* Planejado */}
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.2 }}>
        {fmtHoras(celula.horasPlanejadas)}h
      </div>
      {/* Placeholder realizado — preenchido no C3 */}
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
        — real.
      </div>
    </td>
  );
}

// ── Seletor de mês ────────────────────────────────────────────────────────────

function SeletorMes({
  mes, ano, onMes, onAno,
}: {
  mes: number; ano: number;
  onMes: (m: number) => void;
  onAno: (a: number) => void;
}) {
  const prev = () => {
    if (mes === 1) { onMes(12); onAno(ano - 1); }
    else onMes(mes - 1);
  };
  const next = () => {
    if (mes === 12) { onMes(1); onAno(ano + 1); }
    else onMes(mes + 1);
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={prev}
        className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
        style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <ChevronLeft size={14} />
      </button>

      <div className="flex items-center gap-1.5">
        <select
          value={mes}
          onChange={e => onMes(parseInt(e.target.value))}
          style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '4px 8px', fontSize: 13,
            color: 'var(--text-1)', outline: 'none',
          }}
        >
          {MESES.map((nm, i) => (
            <option key={i + 1} value={i + 1}>{nm}</option>
          ))}
        </select>
        <input
          type="number"
          value={ano}
          min={2020} max={2100}
          onChange={e => onAno(parseInt(e.target.value))}
          style={{
            width: 72, background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '4px 8px', fontSize: 13,
            color: 'var(--text-1)', outline: 'none', textAlign: 'center',
          }}
        />
      </div>

      <button
        onClick={next}
        className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
        style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function GridAlocacao() {
  const { token, user } = useAuth();

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [data, setData]       = useState<GridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');

  const fetchGrid = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await fetch(`/api/alocacoes/grid?ano=${ano}&mes=${mes}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json();
        setErro(d.error || 'Erro ao carregar grid');
        setData(null);
      } else {
        setData(await res.json());
      }
    } catch {
      setErro('Erro de rede');
    } finally {
      setLoading(false);
    }
  }, [token, ano, mes]);

  useEffect(() => { fetchGrid(); }, [fetchGrid]);

  // ── Estilos das colunas fixas ─────────────────────────────────────────────
  const stickyColabStyle: React.CSSProperties = {
    position: 'sticky', left: 0, zIndex: 10,
    width: COL_COLAB_W, minWidth: COL_COLAB_W,
    background: 'var(--surface-1)',
    borderRight: '1px solid var(--border)',
    padding: '10px 12px',
  };

  const stickySaldoStyle: React.CSSProperties = {
    position: 'sticky', left: COL_COLAB_W, zIndex: 10,
    width: COL_SALDO_W, minWidth: COL_SALDO_W,
    background: 'var(--surface-1)',
    borderRight: '2px solid var(--border)',
    padding: '10px 12px',
  };

  const thBase: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--text-3)',
    background: 'var(--surface-2)',
    borderBottom: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    verticalAlign: 'bottom',
  };

  const mesLabel = `${MESES[mes - 1]} ${ano}`;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-6 py-3 shrink-0 flex-wrap gap-y-2"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}
      >
        <div className="flex items-center gap-2">
          <LayoutGrid size={17} style={{ color: 'var(--brand-500)' }} />
          <h1 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
            Grid de Alocação
          </h1>
        </div>

        <SeletorMes mes={mes} ano={ano} onMes={setMes} onAno={setAno} />

        {data && (
          <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
            {data.linhas.length} colaborador{data.linhas.length !== 1 ? 'es' : ''} ·{' '}
            {data.projetos.length} projeto{data.projetos.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Conteúdo ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {/* Estados de carregamento e erro */}
        {loading && (
          <div className="flex items-center justify-center h-40 gap-2" style={{ color: 'var(--text-3)' }}>
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
              <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Carregando grid de {mesLabel}…
          </div>
        )}

        {!loading && erro && (
          <div className="p-6 text-sm" style={{ color: '#f87171' }}>{erro}</div>
        )}

        {!loading && !erro && data && data.projetos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-60 gap-2" style={{ color: 'var(--text-3)' }}>
            <LayoutGrid size={40} strokeWidth={1} />
            <p className="text-sm">Nenhum projeto ativo encontrado.</p>
            <p className="text-xs">Crie projetos em <strong>/projetos</strong> para começar a alocar.</p>
          </div>
        )}

        {!loading && !erro && data && data.projetos.length > 0 && data.linhas.length === 0 && (
          <div className="flex flex-col items-center justify-center h-60 gap-2" style={{ color: 'var(--text-3)' }}>
            <LayoutGrid size={40} strokeWidth={1} />
            <p className="text-sm font-medium">Nenhuma alocação em {mesLabel}.</p>
            <p className="text-xs">
              Use a tela <strong>/alocacoes</strong> para alocar colaboradores neste mês.
            </p>
          </div>
        )}

        {/* ── Grid ─────────────────────────────────────────────────────── */}
        {!loading && !erro && data && data.linhas.length > 0 && (
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              tableLayout: 'fixed',
              minWidth: COL_COLAB_W + COL_SALDO_W + data.projetos.length * COL_PROJ_W,
            }}
          >
            {/* Larguras fixas via colgroup */}
            <colgroup>
              <col style={{ width: COL_COLAB_W }} />
              <col style={{ width: COL_SALDO_W }} />
              {data.projetos.map(p => <col key={p.id} style={{ width: COL_PROJ_W }} />)}
            </colgroup>

            {/* Cabeçalho */}
            <thead>
              <tr>
                {/* Col 1 — Colaborador (sticky) */}
                <th
                  style={{
                    ...thBase,
                    ...stickyColabStyle,
                    background: 'var(--surface-2)',
                    zIndex: 20,
                  }}
                >
                  Colaborador
                </th>

                {/* Col 2 — Saldo (sticky) */}
                <th
                  style={{
                    ...thBase,
                    ...stickySaldoStyle,
                    background: 'var(--surface-2)',
                    zIndex: 20,
                    left: COL_COLAB_W,
                    borderRight: '2px solid var(--border)',
                  }}
                >
                  Saldo {TETO}h
                  {/* Legenda: cor = lotação · textura = quem alocou */}
                  <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-3)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{
                        display: 'inline-block', width: 9, height: 9,
                        background: '#22c55e', borderRadius: 2, flexShrink: 0,
                      }} />
                      você
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{
                        display: 'inline-block', width: 9, height: 9,
                        background: 'repeating-linear-gradient(45deg,#22c55e,#22c55e 2px,transparent 2px,transparent 5px)',
                        borderRadius: 2, flexShrink: 0,
                      }} />
                      outros
                    </span>
                  </div>
                </th>

                {/* Colunas de projeto */}
                {data.projetos.map(p => (
                  <th key={p.id} style={{ ...thBase, textAlign: 'center', width: COL_PROJ_W }}>
                    <div
                      style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-500)' }}
                      title={p.nome}
                    >
                      {p.codigo}
                    </div>
                    <div
                      style={{
                        fontSize: 10, fontWeight: 400, color: 'var(--text-3)',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', maxWidth: COL_PROJ_W - 16,
                      }}
                      title={p.nome}
                    >
                      {p.nome}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            {/* Linhas de colaboradores */}
            <tbody>
              {data.linhas.map((linha, idx) => {
                const totalG  = parseFloat(linha.saldo.totalGeral);
                const pctTotal = (totalG / TETO) * 100;
                const cor = corSaldo(pctTotal);
                const rowBg = idx % 2 === 0 ? 'var(--surface-1)' : 'var(--surface-2)';

                return (
                  <tr key={linha.colaborador.id}>
                    {/* Col 1 — Colaborador (sticky) */}
                    <td
                      style={{
                        ...stickyColabStyle,
                        background: rowBg,
                        verticalAlign: 'middle',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13, fontWeight: 600,
                          color: 'var(--text-1)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                        title={linha.colaborador.nome}
                      >
                        {linha.colaborador.nome}
                      </div>
                      {linha.colaborador.funcao && (
                        <div
                          style={{
                            fontSize: 10, color: 'var(--text-3)', marginTop: 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >
                          {linha.colaborador.funcao}
                        </div>
                      )}
                    </td>

                    {/* Col 2 — Saldo (sticky) */}
                    <td
                      style={{
                        ...stickySaldoStyle,
                        background: rowBg,
                        left: COL_COLAB_W,
                        borderRight: '2px solid var(--border)',
                        verticalAlign: 'middle',
                      }}
                    >
                      <BarraSaldo saldo={linha.saldo} />
                      {pctTotal >= 90 && (
                        <div
                          style={{
                            fontSize: 9, marginTop: 3,
                            color: cor, fontWeight: 600,
                          }}
                        >
                          {pctTotal >= 100
                            ? 'Capacidade esgotada'
                            : `${(TETO - totalG).toFixed(1)}h disponíveis`}
                        </div>
                      )}
                    </td>

                    {/* Células de projeto */}
                    {data.projetos.map(p => (
                      <CelulaGrid key={p.id} celula={linha.celulas[p.id] ?? null} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
