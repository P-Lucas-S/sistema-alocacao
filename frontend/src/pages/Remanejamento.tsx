import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ArrowLeftRight, Send, Inbox } from 'lucide-react';

const MESES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

interface Solicitacao {
  id: string;
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
  const pct = solicitado > 0 ? Math.min(100, (cedido / solicitado) * 100) : 0;
  const done = pct >= 100;
  return (
    <div>
      <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: done ? '#4ade80' : 'var(--brand)',
          borderRadius: 999,
          transition: 'width 0.3s ease',
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

function MeuCard({ s }: { s: Solicitacao }) {
  const cedido     = parseFloat(s.horasJaCedidas);
  const solicitado = parseFloat(s.horasSolicitadas);

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
    </div>
  );
}

function RecebidaCard({ s }: { s: Solicitacao }) {
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
      <div style={{
        background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Faltam <strong style={{ color: 'var(--text-1)' }}>{restantes}h</strong>
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>de {solicitado}h solicitadas</span>
      </div>
    </div>
  );
}

export default function Remanejamento() {
  const { token } = useAuth();
  const [minhas, setMinhas]       = useState<Solicitacao[]>([]);
  const [recebidas, setRecebidas] = useState<Solicitacao[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

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
  }, [token]);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <ArrowLeftRight size={18} style={{ color: 'var(--brand)' }} />
        <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Remanejamento</h1>
      </div>

      <Section title="Minhas solicitações" icon={<Send size={14} />}>
        {minhas.length === 0
          ? <Empty text="Nenhuma solicitação criada ainda." />
          : <CardGrid>{minhas.map(s => <MeuCard key={s.id} s={s} />)}</CardGrid>
        }
      </Section>

      <Section title="Recebidas (posso ceder)" icon={<Inbox size={14} />}>
        {recebidas.length === 0
          ? <Empty text="Nenhuma pendência recebida." />
          : <CardGrid>{recebidas.map(s => <RecebidaCard key={s.id} s={s} />)}</CardGrid>
        }
      </Section>
    </div>
  );
}
