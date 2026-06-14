import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ArrowLeftRight, Send, Inbox, X } from 'lucide-react';

const MESES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

interface Solicitacao {
  id: string;
  colaboradorId: string;
  status: string;
  ano: number;
  mes: number;
  horasSolicitadas: string;
  horasJaCedidas: string;
  horasRestantes: string;
  colaborador: { nome: string };
  projetoDestino: { codigo: string; nome: string };
  macroEntregaDestino: { nome: string };
  microEntregaDestino: { nome: string };
  solicitante: { name: string };
}

interface AlocacaoOrigem {
  alocacaoId: string;
  projetoCodigo: string;
  projetoNome: string;
  macroNome: string;
  microNome: string;
  horasPlanejadas: string;
}

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  aberta:            { label: 'Aberta',            bg: 'hsl(221 83% 53% / 0.12)', color: '#60a5fa' },
  atendida:          { label: 'Atendida',           bg: 'hsl(142 71% 45% / 0.12)', color: '#4ade80' },
  encerrada_parcial: { label: 'Encerrada parcial',  bg: 'hsl(38 92% 50% / 0.12)',  color: '#fb923c' },
  cancelada:         { label: 'Cancelada',           bg: 'hsl(0 0% 50% / 0.12)',    color: 'var(--text-3)' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, bg: 'hsl(0 0% 50% / 0.12)', color: 'var(--text-3)' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function ProgressBar({ cedido, solicitado }: { cedido: number; solicitado: number }) {
  const pct  = solicitado > 0 ? Math.min(100, (cedido / solicitado) * 100) : 0;
  const done = pct >= 100;
  return (
    <div>
      <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: done ? '#4ade80' : 'var(--brand-500)',
          borderRadius: 999, transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
        <span>{cedido}h cedidas</span>
        <span>{solicitado}h solicitadas</span>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ color: 'var(--text-3)', display: 'flex' }}>{icon}</span>
        <h2 style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', margin: 0 }}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '32px 0', borderRadius: 12,
      border: '1px dashed var(--border)', color: 'var(--text-3)', fontSize: 13,
    }}>
      {text}
    </div>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
      {children}
    </div>
  );
}

function MeuCard({ s, onCancelar, onEncerrar }: {
  s: Solicitacao;
  onCancelar: (s: Solicitacao) => void;
  onEncerrar: (s: Solicitacao) => void;
}) {
  const cedido     = parseFloat(s.horasJaCedidas);
  const solicitado = parseFloat(s.horasSolicitadas);

  const showCancelar = s.status === 'aberta' && cedido === 0;
  const showEncerrar = s.status === 'aberta' && cedido > 0;

  const btnBase: React.CSSProperties = {
    marginTop: 12, width: '100%', padding: '7px 0', borderRadius: 8,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
  };

  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: 0, marginBottom: 2 }}>
            {s.colaborador.nome}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.4 }}>
            {s.projetoDestino.codigo} — {s.projetoDestino.nome}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, lineHeight: 1.4 }}>
            {s.macroEntregaDestino.nome} › {s.microEntregaDestino.nome}
          </p>
        </div>
        <StatusBadge status={s.status} />
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, marginBottom: 10 }}>
        {MESES[s.mes - 1]}/{s.ano}
      </p>
      <ProgressBar cedido={cedido} solicitado={solicitado} />

      {showCancelar && (
        <button
          onClick={() => onCancelar(s)}
          style={{ ...btnBase, background: 'hsl(0 85% 60% / 0.10)', color: '#f87171', border: '1px solid hsl(0 85% 60% / 0.25)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(0 85% 60% / 0.18)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(0 85% 60% / 0.10)'; }}
        >
          Cancelar
        </button>
      )}
      {showEncerrar && (
        <button
          onClick={() => onEncerrar(s)}
          style={{ ...btnBase, background: 'hsl(38 92% 50% / 0.10)', color: '#fb923c', border: '1px solid hsl(38 92% 50% / 0.28)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(38 92% 50% / 0.18)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(38 92% 50% / 0.10)'; }}
        >
          Encerrar
        </button>
      )}
    </div>
  );
}

function RecebidaCard({ s, onCeder }: { s: Solicitacao; onCeder: (s: Solicitacao) => void }) {
  const restantes  = parseFloat(s.horasRestantes);
  const solicitado = parseFloat(s.horasSolicitadas);
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: 0, marginBottom: 2 }}>
            {s.colaborador.nome}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
            pedido por {s.solicitante.name}
          </p>
        </div>
        <StatusBadge status={s.status} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0, marginBottom: 2 }}>
        Para: {s.projetoDestino.codigo} — {s.projetoDestino.nome}
      </p>
      <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0, marginBottom: 12 }}>
        {s.macroEntregaDestino.nome} › {s.microEntregaDestino.nome} · {MESES[s.mes - 1]}/{s.ano}
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{
          background: 'var(--surface-2)', borderRadius: 8, padding: '6px 12px',
          display: 'flex', gap: 8, alignItems: 'center', flex: 1,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            Faltam <strong style={{ color: 'var(--text-1)' }}>{restantes}h</strong>
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>de {solicitado}h</span>
        </div>
        <button
          className="btn-brand"
          onClick={() => onCeder(s)}
          style={{ padding: '5px 14px', fontSize: 12, flexShrink: 0 }}
        >
          Ceder
        </button>
      </div>
    </div>
  );
}

function ModalCeder({ sol, token, onClose, onSuccess }: {
  sol: Solicitacao;
  token: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [origens, setOrigens]           = useState<AlocacaoOrigem[]>([]);
  const [loadingOrigens, setLoadingOrigens] = useState(true);
  const [origemIdx, setOrigemIdx]       = useState(0);
  const [horasCeder, setHorasCeder]     = useState('');
  const [cedendo, setCedendo]           = useState(false);
  const [erro, setErro]                 = useState('');

  // generated once when modal mounts
  const [idempotencia] = useState<string>(() => {
    try { return crypto.randomUUID(); } catch {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
  });

  const restantes = parseFloat(sol.horasRestantes);

  useEffect(() => {
    async function loadOrigens() {
      try {
        const res = await fetch(
          `/api/alocacoes/minhas-do-colaborador?colaboradorId=${encodeURIComponent(sol.colaboradorId)}&ano=${sol.ano}&mes=${sol.mes}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data: AlocacaoOrigem[] = await res.json();
          setOrigens(data);
          if (data.length > 0) {
            setHorasCeder(String(Math.min(restantes, parseFloat(data[0].horasPlanejadas))));
          }
        }
      } finally {
        setLoadingOrigens(false);
      }
    }
    loadOrigens();
  }, [sol.colaboradorId, sol.ano, sol.mes, token, restantes]);

  function handleOrigemChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const idx = parseInt(e.target.value);
    setOrigemIdx(idx);
    const o = origens[idx];
    if (o) setHorasCeder(String(Math.min(restantes, parseFloat(o.horasPlanejadas))));
    setErro('');
  }

  async function handleCeder() {
    const origem = origens[origemIdx];
    if (!origem) { setErro('Selecione uma alocação de origem.'); return; }
    const h = parseFloat(horasCeder);
    if (isNaN(h) || h <= 0) { setErro('Informe uma quantidade válida de horas.'); return; }
    setCedendo(true);
    setErro('');
    try {
      const res = await fetch(`/api/remanejamento/solicitacoes/${sol.id}/cessoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ alocacaoOrigemId: origem.alocacaoId, horasCedidas: h, idempotencia }),
      });
      const d = await res.json();
      if (res.status === 201) {
        const efetivas = parseFloat(d.horasCedidasEfetivas ?? String(h));
        const msg = d.ajustado
          ? `Cedido! Ajustado para ${efetivas}h (era o que faltava).`
          : `${efetivas}h cedidas com sucesso.`;
        onSuccess(msg);
      } else {
        setErro(d.error ?? 'Erro ao ceder horas.');
      }
    } catch {
      setErro('Erro de rede.');
    } finally {
      setCedendo(false);
    }
  }

  const origemAtual = origens[origemIdx];

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)',
    fontSize: 13, outline: 'none',
  };

  const cedidoPct = parseFloat(sol.horasSolicitadas) > 0
    ? Math.min(100, (parseFloat(sol.horasJaCedidas) / parseFloat(sol.horasSolicitadas)) * 100)
    : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', zIndex: 200 }}
        onMouseDown={() => { if (!cedendo) onClose(); }}
      />
      {/* Modal */}
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 201, width: 460, maxWidth: 'calc(100vw - 32px)',
          background: 'var(--surface-1)', borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.32)',
          padding: '22px 24px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Ceder horas</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4, borderRadius: 6 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Contexto do pedido */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 3px' }}>
            {sol.colaborador.nome}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 2px' }}>
            pedido por {sol.solicitante.name} · {MESES[sol.mes - 1]}/{sol.ano}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-2)', margin: '0 0 8px' }}>
            Para:{' '}
            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{sol.projetoDestino.codigo}</span>
            {' '}— {sol.projetoDestino.nome}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${cedidoPct}%`, background: 'var(--brand-500)', borderRadius: 999 }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
              {sol.horasJaCedidas}h/{sol.horasSolicitadas}h — faltam{' '}
              <strong style={{ color: 'var(--text-1)' }}>{sol.horasRestantes}h</strong>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Origem */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
              Sua alocação de origem
            </label>
            {loadingOrigens ? (
              <div style={{ ...inputStyle, color: 'var(--text-3)' }}>Carregando…</div>
            ) : origens.length === 0 ? (
              <div style={{ ...inputStyle, color: '#f87171', fontSize: 12 }}>
                Você não tem alocações deste colaborador neste mês.
              </div>
            ) : (
              <select
                value={origemIdx}
                onChange={handleOrigemChange}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {origens.map((o, i) => (
                  <option key={o.alocacaoId} value={i}>
                    {o.projetoCodigo} — {o.projetoNome} / {o.macroNome} / {o.microNome} ({o.horasPlanejadas}h)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Horas a ceder */}
          {origens.length > 0 && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                Horas a ceder
              </label>
              <input
                type="number"
                value={horasCeder}
                min={0.5}
                step={0.5}
                max={origemAtual ? parseFloat(origemAtual.horasPlanejadas) : undefined}
                autoFocus
                onChange={e => { setHorasCeder(e.target.value); setErro(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleCeder(); }
                  if (e.key === 'Escape') { e.preventDefault(); onClose(); }
                }}
                style={inputStyle}
              />
              {origemAtual && (
                <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }}>
                  Disponível nesta alocação: {origemAtual.horasPlanejadas}h
                </p>
              )}
            </div>
          )}

          {/* Aviso net-zero */}
          {origens.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, lineHeight: 1.55 }}>
              Essas horas saem da sua alocação escolhida e vão para{' '}
              <strong style={{ color: 'var(--text-2)' }}>{sol.projetoDestino.nome}</strong>{' '}
              de {sol.solicitante.name} — o total do colaborador no mês não muda.
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div style={{ padding: '8px 10px', background: 'hsl(0 85% 60% / 0.08)', border: '1px solid hsl(0 85% 60% / 0.25)', borderRadius: 8, fontSize: 12, color: '#f87171' }}>
              {erro}
            </div>
          )}

          {/* Botões */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              onClick={onClose}
              disabled={cedendo}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: cedendo ? 0.6 : 1 }}
            >
              Cancelar
            </button>
            <button
              className="btn-brand"
              onClick={handleCeder}
              disabled={cedendo || origens.length === 0 || loadingOrigens}
              style={{ flex: 1, padding: '9px 0', fontSize: 13 }}
            >
              {cedendo ? 'Cedendo…' : 'Ceder'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ModalConfirm({ acao, token, onClose, onSuccess }: {
  acao: { tipo: 'cancelar' | 'encerrar'; sol: Solicitacao };
  token: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro]             = useState('');

  const { tipo, sol } = acao;
  const isCancelar    = tipo === 'cancelar';
  const cedido        = parseFloat(sol.horasJaCedidas);
  const restantes     = parseFloat(sol.horasRestantes);

  async function handleConfirm() {
    setExecutando(true);
    setErro('');
    try {
      const res = await fetch(`/api/remanejamento/solicitacoes/${sol.id}/${tipo}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        onSuccess(isCancelar ? 'Solicitação cancelada.' : 'Solicitação encerrada parcialmente.');
      } else {
        const d = await res.json().catch(() => ({}));
        setErro((d as { error?: string }).error ?? 'Erro ao processar.');
      }
    } catch {
      setErro('Erro de rede.');
    } finally {
      setExecutando(false);
    }
  }

  const descricao = isCancelar
    ? 'Nada foi cedido ainda — ela é encerrada sem efeito.'
    : `As ${cedido}h já cedidas continuam no destino; você só para de esperar as ${restantes}h restantes.`;

  const btnAcaoStyle: React.CSSProperties = {
    flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
    fontSize: 13, fontWeight: 600,
    cursor: executando ? 'not-allowed' : 'pointer',
    opacity: executando ? 0.6 : 1,
    background: isCancelar ? '#ef4444' : '#f59e0b',
    color: '#fff',
  };

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', zIndex: 200 }}
        onMouseDown={() => { if (!executando) onClose(); }}
      />
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 201, width: 400, maxWidth: 'calc(100vw - 32px)',
          background: 'var(--surface-1)', borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.32)',
          padding: '22px 24px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
            {isCancelar ? 'Cancelar solicitação?' : 'Encerrar solicitação?'}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4, borderRadius: 6 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Contexto */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 2px' }}>
            {sol.colaborador.nome}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
            {sol.projetoDestino.codigo} · {MESES[sol.mes - 1]}/{sol.ano}
          </p>
        </div>

        {/* Descrição */}
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 16px', lineHeight: 1.6 }}>
          {descricao}
        </p>

        {erro && (
          <div style={{ padding: '8px 10px', background: 'hsl(0 85% 60% / 0.08)', border: '1px solid hsl(0 85% 60% / 0.25)', borderRadius: 8, fontSize: 12, color: '#f87171', marginBottom: 12 }}>
            {erro}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            disabled={executando}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: executando ? 0.6 : 1 }}
          >
            Voltar
          </button>
          <button onClick={handleConfirm} disabled={executando} style={btnAcaoStyle}>
            {executando ? '…' : isCancelar ? 'Cancelar solicitação' : 'Encerrar'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function Remanejamento() {
  const { token } = useAuth();
  const [minhas, setMinhas]         = useState<Solicitacao[]>([]);
  const [recebidas, setRecebidas]   = useState<Solicitacao[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [modalCeder, setModalCeder]       = useState<Solicitacao | null>(null);
  const [confirmacao, setConfirmacao]     = useState<{ tipo: 'cancelar' | 'encerrar'; sol: Solicitacao } | null>(null);
  const [feedback, setFeedback]           = useState('');
  const [fetchKey, setFetchKey]           = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/remanejamento/solicitacoes', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { setError('Erro ao carregar solicitações.'); return; }
        const data = await res.json();
        setMinhas(data.minhas ?? []);
        setRecebidas(data.recebidas ?? []);
      } catch {
        setError('Erro de rede.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token, fetchKey]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(''), 5000);
    return () => clearTimeout(t);
  }, [feedback]);

  function handleCederSuccess(msg: string) {
    setModalCeder(null);
    setFeedback(msg);
    setFetchKey(k => k + 1);
  }

  function handleAcaoSuccess(msg: string) {
    setConfirmacao(null);
    setFeedback(msg);
    setFetchKey(k => k + 1);
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-3)' }}>
      Carregando…
    </div>
  );

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#f87171' }}>
      {error}
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ArrowLeftRight size={18} style={{ color: 'var(--brand-500)' }} />
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Remanejamento</h1>
        </div>
        {feedback && (
          <div style={{
            fontSize: 12, color: '#22c55e', fontWeight: 600,
            background: 'hsl(142 71% 45% / 0.10)',
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid hsl(142 71% 45% / 0.25)',
          }}>
            ✓ {feedback}
          </div>
        )}
      </div>

      <Section title="Minhas solicitações" icon={<Send size={14} />}>
        {minhas.length === 0
          ? <Empty text="Nenhuma solicitação criada ainda." />
          : <CardGrid>{minhas.map(s => (
              <MeuCard
                key={s.id}
                s={s}
                onCancelar={s => setConfirmacao({ tipo: 'cancelar', sol: s })}
                onEncerrar={s => setConfirmacao({ tipo: 'encerrar', sol: s })}
              />
            ))}</CardGrid>
        }
      </Section>

      <Section title="Recebidas (posso ceder)" icon={<Inbox size={14} />}>
        {recebidas.length === 0
          ? <Empty text="Nenhuma pendência recebida." />
          : <CardGrid>{recebidas.map(s => <RecebidaCard key={s.id} s={s} onCeder={setModalCeder} />)}</CardGrid>
        }
      </Section>

      {modalCeder && (
        <ModalCeder
          sol={modalCeder}
          token={token!}
          onClose={() => setModalCeder(null)}
          onSuccess={handleCederSuccess}
        />
      )}

      {confirmacao && (
        <ModalConfirm
          acao={confirmacao}
          token={token!}
          onClose={() => setConfirmacao(null)}
          onSuccess={handleAcaoSuccess}
        />
      )}
    </div>
  );
}
