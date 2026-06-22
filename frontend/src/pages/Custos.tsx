import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { DollarSign } from 'lucide-react';

interface ColaboradorCusto {
  nome: string;
  funcao: string | null;
  horasTotais: string;
  valorHora: string | null;
  custo: string | null;
}

interface ProjetoCusto {
  id: string;
  codigo: string;
  nome: string;
  custoTotal: string;
  colaboradores: ColaboradorCusto[];
}

function fmtMoeda(v: string): string {
  return parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtHoras(h: string): string {
  const n = parseFloat(h);
  return Number.isInteger(n) ? `${n}h` : `${n.toFixed(1)}h`;
}

const th: React.CSSProperties = {
  padding: '8px 12px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
  textAlign: 'left',
};

const td: React.CSSProperties = {
  padding: '8px 12px', fontSize: 13, color: 'var(--text-1)',
  borderBottom: '1px solid var(--border)',
};

export default function Custos() {
  const { token } = useAuth();
  const [projetos, setProjetos] = useState<ProjetoCusto[]>([]);
  const [loading, setLoading]   = useState(true);
  const [erro, setErro]         = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErro('');
      try {
        const res = await fetch('/api/relatorios/custos', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setProjetos(await res.json());
        } else {
          const d = await res.json();
          setErro(d.error || 'Erro ao carregar relatório de custos.');
        }
      } catch {
        setErro('Erro de rede.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  return (
    <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <DollarSign size={20} style={{ color: 'var(--brand-500)' }} />
          Custos por Projeto
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
          Custo total planejado (todos os meses), por projeto e colaborador.
        </p>
      </div>

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
      ) : projetos.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2" style={{ color: 'var(--text-3)' }}>
          <DollarSign size={40} strokeWidth={1} />
          <p className="text-sm">Nenhum projeto encontrado.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {projetos.map(proj => (
            <div key={proj.id} className="card p-5 flex flex-col gap-4">
              {/* Cabeçalho */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold" style={{ fontFamily: 'monospace', color: 'var(--brand-500)' }}>
                    {proj.codigo}
                  </span>
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                    {proj.nome}
                  </span>
                </div>
                <span className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
                  {fmtMoeda(proj.custoTotal)}
                </span>
              </div>

              {/* Quebra por colaborador */}
              {proj.colaboradores.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Nenhuma alocação registrada neste projeto.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Colaborador</th>
                        <th style={th}>Cargo</th>
                        <th style={{ ...th, textAlign: 'right' }}>Horas</th>
                        <th style={{ ...th, textAlign: 'right' }}>Valor/hora</th>
                        <th style={{ ...th, textAlign: 'right' }}>Custo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proj.colaboradores.map((c, i) => (
                        <tr key={i}>
                          <td style={td}>
                            <div className="flex items-center gap-2">
                              <span>{c.nome}</span>
                              {c.valorHora == null && (
                                <span
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'hsl(0 0% 50% / 0.12)', color: 'var(--text-3)' }}
                                >
                                  sem valor-hora
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={td}>{c.funcao || '—'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtHoras(c.horasTotais)}</td>
                          <td style={{ ...td, textAlign: 'right', color: c.valorHora == null ? 'var(--text-3)' : 'var(--text-1)' }}>
                            {c.valorHora != null ? `${fmtMoeda(c.valorHora)}/h` : '—'}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: c.custo == null ? 'var(--text-3)' : 'var(--text-1)' }}>
                            {c.custo != null ? fmtMoeda(c.custo) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
