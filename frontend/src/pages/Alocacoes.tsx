import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

// Tipos mínimos necessários
interface Colaborador { id: string; nome: string; profissao: { id: string; nome: string } | null; ativo: boolean }
interface Projeto      { id: string; codigo: string; nome: string; gestorId: string }
interface Macro        { id: string; nome: string; microEntregas: { id: string; nome: string }[] }

interface BloqueioInfo {
  totalAlocado: string;
  horasSolicitadas: string;
  horasDisponiveis: string;
  distribuicao: { projetoCodigo: string; projetoNome: string; gestorNome: string; horas: string }[];
}

const sel: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none', width: '100%',
};
const inp: React.CSSProperties = { ...sel };
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</label>
    {children}
  </div>
);

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export default function Alocacoes() {
  const { token, user } = useAuth();

  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [projetos,      setProjetos]      = useState<Projeto[]>([]);
  const [macros,        setMacros]        = useState<Macro[]>([]);

  const [colaboradorId,  setColaboradorId]  = useState('');
  const [projetoId,      setProjetoId]      = useState('');
  const [macroEntregaId, setMacroEntregaId] = useState('');
  const [microEntregaId, setMicroEntregaId] = useState('');
  const [ano,            setAno]            = useState(String(new Date().getFullYear()));
  const [mes,            setMes]            = useState(String(new Date().getMonth() + 1));
  const [horas,          setHoras]          = useState('');

  const [saving,   setSaving]   = useState(false);
  const [sucesso,  setSucesso]  = useState<{ somaFinal: string; horasRestantes: string } | null>(null);
  const [bloqueio, setBloqueio] = useState<BloqueioInfo | null>(null);
  const [erro,     setErro]     = useState('');

  // Carrega colaboradores e projetos ao montar
  useEffect(() => {
    fetch('/api/colaboradores?ativo=true', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setColaboradores).catch(() => {});
    fetch('/api/projetos?status=ativo', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setProjetos).catch(() => {});
  }, [token]);

  // Carrega macros + micros quando projeto muda
  useEffect(() => {
    setMacros([]);
    setMacroEntregaId('');
    setMicroEntregaId('');
    if (!projetoId) return;
    fetch(`/api/projetos/${projetoId}/macros`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setMacros).catch(() => {});
  }, [projetoId, token]);

  // Reset micro quando macro muda
  useEffect(() => { setMicroEntregaId(''); }, [macroEntregaId]);

  const macroSelecionada = macros.find(m => m.id === macroEntregaId);

  function resetResultado() { setSucesso(null); setBloqueio(null); setErro(''); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetResultado();
    setSaving(true);
    try {
      const res = await fetch('/api/alocacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          colaboradorId, projetoId, macroEntregaId, microEntregaId,
          ano: parseInt(ano), mes: parseInt(mes),
          horasPlanejadas: parseFloat(horas),
        }),
      });
      const data = await res.json();

      if (res.status === 409 && data.bloqueado) {
        setBloqueio(data);
      } else if (!res.ok) {
        setErro(data.error || 'Erro desconhecido');
      } else {
        setSucesso({ somaFinal: data.somaFinalMes, horasRestantes: data.horasRestantes });
        setHoras('');
      }
    } catch {
      setErro('Erro de rede');
    } finally {
      setSaving(false);
    }
  }

  const nomeMes = MESES[parseInt(mes) - 1] ?? '';

  return (
    <div className="p-6 max-w-2xl flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <Clock size={20} style={{ color: 'var(--brand-500)' }} />
          Alocação de Horas Planejadas
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
          Teto: 220h por colaborador/mês (somando todos os projetos).
          {user?.role === 'coordenacao' && ' Coordenação não pode alocar.'}
        </p>
      </div>

      {/* Resultado de sucesso */}
      {sucesso && (
        <div className="flex items-start gap-3 p-4 rounded-xl" style={{ background: 'hsl(142 71% 45% / 0.1)', border: '1px solid hsl(142 71% 45% / 0.3)' }}>
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" style={{ color: '#4ade80' }} />
          <div>
            <p className="font-semibold text-sm" style={{ color: '#4ade80' }}>Alocação gravada com sucesso</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
              Total alocado no mês: <strong>{sucesso.somaFinal}h</strong> &nbsp;·&nbsp;
              Restam: <strong>{sucesso.horasRestantes}h</strong> de 220h
            </p>
          </div>
        </div>
      )}

      {/* Resultado de bloqueio */}
      {bloqueio && (
        <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ background: 'hsl(0 85% 60% / 0.08)', border: '1px solid hsl(0 85% 60% / 0.3)' }}>
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: '#f87171' }}>
                Teto de 220h excedido — alocação bloqueada
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                Já alocado: <strong>{bloqueio.totalAlocado}h</strong> &nbsp;·&nbsp;
                Solicitado: <strong>{bloqueio.horasSolicitadas}h</strong> &nbsp;·&nbsp;
                Disponível: <strong>{bloqueio.horasDisponiveis}h</strong>
              </p>
            </div>
          </div>
          {bloqueio.distribuicao.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Distribuição atual das {bloqueio.totalAlocado}h:
              </p>
              {bloqueio.distribuicao.map((d, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs" style={{ background: 'var(--surface-2)' }}>
                  <span style={{ color: 'var(--text-1)' }}>
                    <span className="font-mono font-bold" style={{ color: 'var(--brand-500)' }}>{d.projetoCodigo}</span>
                    {' '}{d.projetoNome}
                    <span style={{ color: 'var(--text-3)' }}> · {d.gestorNome}</span>
                  </span>
                  <span className="font-bold" style={{ color: 'var(--text-1)' }}>{d.horas}h</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Erro genérico */}
      {erro && (
        <div className="p-3 rounded-xl text-sm" style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 65%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>
          {erro}
        </div>
      )}

      {/* Formulário */}
      {user?.role !== 'coordenacao' && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Colaborador">
            <select value={colaboradorId} onChange={e => { setColaboradorId(e.target.value); resetResultado(); }} style={sel} required>
              <option value="">Selecione…</option>
              {colaboradores.map(c => (
                <option key={c.id} value={c.id}>{c.nome}{c.profissao ? ` — ${c.profissao.nome}` : ''}</option>
              ))}
            </select>
          </Field>

          <Field label="Projeto">
            <select value={projetoId} onChange={e => { setProjetoId(e.target.value); resetResultado(); }} style={sel} required>
              <option value="">Selecione…</option>
              {projetos.map(p => (
                <option key={p.id} value={p.id}>[{p.codigo}] {p.nome}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Macro-Entrega">
              <select value={macroEntregaId} onChange={e => { setMacroEntregaId(e.target.value); resetResultado(); }} style={sel} required disabled={!projetoId}>
                <option value="">Selecione…</option>
                {macros.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </Field>
            <Field label="Micro-Entrega">
              <select value={microEntregaId} onChange={e => { setMicroEntregaId(e.target.value); resetResultado(); }} style={sel} required disabled={!macroEntregaId}>
                <option value="">Selecione…</option>
                {(macroSelecionada?.microEntregas ?? []).map(m => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Mês">
              <select value={mes} onChange={e => { setMes(e.target.value); resetResultado(); }} style={sel} required>
                {MESES.map((nm, i) => <option key={i+1} value={i+1}>{nm}</option>)}
              </select>
            </Field>
            <Field label="Ano">
              <input type="number" value={ano} onChange={e => { setAno(e.target.value); resetResultado(); }}
                min={2020} max={2100} required style={inp} />
            </Field>
            <Field label="Horas Planejadas">
              <input type="number" value={horas} onChange={e => { setHoras(e.target.value); resetResultado(); }}
                min={0.5} max={220} step={0.5} placeholder="Ex: 40" required style={inp} />
            </Field>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="py-2.5 px-6 rounded-xl text-sm font-semibold text-white self-start"
            style={{ background: 'var(--brand-500)', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Verificando teto…' : `Alocar ${horas ? `${horas}h` : 'horas'} em ${nomeMes}/${ano}`}
          </button>
        </form>
      )}
    </div>
  );
}
