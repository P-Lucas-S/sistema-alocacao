import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { BarChart2, AlertTriangle } from 'lucide-react';
import SeletorMes from '../components/SeletorMes';

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
  const { token } = useAuth();

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [itens, setItens]     = useState<ItemDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErro('');
      try {
        const res = await fetch(`/api/dashboards/projetos?ano=${ano}&mes=${mes}`, {
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
  }, [token, ano, mes]);

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <BarChart2 size={20} style={{ color: 'var(--brand-500)' }} />
            Prioridades
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
            Acompanhamento de projetos por prazo de prestação de contas
          </p>
        </div>
        <SeletorMes mes={mes} ano={ano} onMes={setMes} onAno={setAno} />
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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>Prioridade</th>
                <th style={th}>Projeto</th>
                <th style={th}>Por quê</th>
                <th style={th}>Próx. prestação</th>
                <th style={{ ...th, textAlign: 'right' }}>Planejadas</th>
                <th style={{ ...th, textAlign: 'right' }}>Realizadas</th>
                <th style={{ ...th, textAlign: 'right' }}>Custo plan.</th>
                <th style={{ ...th, textAlign: 'right' }}>Equipe</th>
                <th style={{ ...th, textAlign: 'center' }}>Cap.</th>
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

                  {/* Custo planejado */}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {item.custoPlanejado != null
                      ? fmtMoeda(item.custoPlanejado)
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

                  {/* Sinal de capacidade */}
                  <td style={{ ...td, textAlign: 'center' }}>
                    {item.sinalCapacidade && (
                      <span title="Equipe no limite de capacidade (≥ 95% do teto mensal)">
                        <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
