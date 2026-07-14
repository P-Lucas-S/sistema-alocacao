import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Brain, BarChart2, Layers, ChevronDown, ChevronRight,
  AlertTriangle, Info, X, Zap, Check,
} from 'lucide-react';
import Combobox from '../components/Combobox';

// ── Types ────────────────────────────────────────────────────────────────────

interface Projeto {
  id: string; codigo: string; nome: string; gestorId: string;
  vigenciaInicio: string | null; vigenciaFim: string | null;
  valorTotal: string | null;
}
interface MacroEntrega { id: string; nome: string; microEntregas?: { id: string; nome: string }[] }
interface MetaMes {
  ano: number; mes: number;
  metaHT: string; receitaPlanejada: string; deficit: string;
  fechado: boolean; pinado: boolean;
}
type MetaData =
  | { configurado: false }
  | { configurado: true; meses: MetaMes[]; resumo: { valorHT: string } };

interface Profissao { id: string; nome: string }
interface Colab { id: string; nome: string; profissao: { id: string; nome: string } | null }

interface LinhaSugestao {
  colaboradorId: string; nome: string; profissao: string; mes: string;
  horas: number; tarifa: string; receita: string;
  camada: 'fixado' | 'equipe' | 'novo';
  disponibilidadeVista: number; disponibilidadeApos: number; explicacao: string;
}
interface TotalMes {
  mes: string; metaHT: string; receitaAtual: string; deficit: string;
  coberto: string; sobra: string; deficitRemanescente: string;
}
interface RemMes { mes: string; valor: string; diagnostico: string[] }
interface Resultado {
  configurado?: false;
  geradoEm: string;
  linhas: LinhaSugestao[];
  totaisPorMes: TotalMes[];
  remanescentes: RemMes[];
  avisos: string[];
}

interface PessoaMatriz {
  colaboradorId: string;
  nome: string;
  profissao: string;
  camada: 'fixado' | 'equipe' | 'novo';
  explicacao: string;
  tarifa: string;
  mesesData: Map<string, { horasOriginal: number; disponibilidadeVista: number }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function fmtMoeda(v: string | number) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtMes(str: string) {
  const [a, m] = str.split('-');
  return `${MESES_ABR[parseInt(m!) - 1]}/${String(a!).slice(2)}`;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--surface-1)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 16,
};
const secLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-3)',
};
const inp: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none', width: '100%',
};
const thSt: React.CSSProperties = {
  padding: '8px 10px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
  textAlign: 'left', whiteSpace: 'nowrap',
};
const tdSt: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13, color: 'var(--text-1)',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
};

// ── Small sub-components ──────────────────────────────────────────────────────

function Tag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
      {label}
      <button type="button" onClick={onRemove}
        style={{ color: 'var(--text-3)', lineHeight: 1, cursor: 'pointer' }}>
        <X size={10} />
      </button>
    </span>
  );
}

function CamadaBadge({ camada }: { camada: 'fixado' | 'equipe' | 'novo' }) {
  const st: Record<string, React.CSSProperties> = {
    fixado: { background: 'var(--brand-500)18', color: 'var(--brand-500)' },
    equipe: { background: 'hsl(220 80% 56% / 0.12)', color: 'hsl(220 80% 55%)' },
    novo:   { background: 'hsl(142 71% 45% / 0.12)', color: 'hsl(142 60% 38%)' },
  };
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={st[camada]}>
      {camada}
    </span>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PlanejamentoWizard() {
  const { id: projetoId } = useParams<{ id: string }>();
  const { token } = useAuth();
  const navigate   = useNavigate();

  // ── remote data ───────────────────────────────────────────────────────────
  const [projeto,   setProjeto]   = useState<Projeto | null>(null);
  const [macros,    setMacros]    = useState<MacroEntrega[]>([]);
  const [metaData,  setMetaData]  = useState<MetaData | null>(null);
  const [profissoes,setProfissoes]= useState<Profissao[]>([]);
  const [colabs,    setColabs]    = useState<Colab[]>([]);
  const [loading,   setLoading]   = useState(true);

  // ── form ─────────────────────────────────────────────────────────────────
  const [macroId,        setMacroId]        = useState('');
  const [mesesSel,       setMesesSel]       = useState<Set<string>>(new Set());
  const [profSel,        setProfSel]        = useState<string[]>([]);
  const [excluidos,      setExcluidos]      = useState<{ id: string; nome: string }[]>([]);
  const [fixados,        setFixados]        = useState<{ id: string; nome: string; minHoras: string }[]>([]);
  const [maxExternos,    setMaxExternos]    = useState('');
  const [minHorasNovo,   setMinHorasNovo]   = useState('8');
  const [maxHorasPessoa, setMaxHorasPessoa] = useState('60');
  const [showAvancados,  setShowAvancados]  = useState(false);

  // picker reset keys (re-mount Combobox to clear search after selection)
  const [profKey,  setProfKey]  = useState(0);
  const [exclKey,  setExclKey]  = useState(0);
  const [fixKey,   setFixKey]   = useState(0);

  // ── result ───────────────────────────────────────────────────────────────
  const [gerando,    setGerando]    = useState(false);
  const [resultado,  setResultado]  = useState<Resultado | null>(null);
  const [erroMotor,  setErroMotor]  = useState('');

  // ── matrix local edits (F5b) ─────────────────────────────────────────────
  const [edicoes,   setEdicoes]   = useState<Map<string, Map<string, number>>>(new Map());
  const [removidos, setRemovidos] = useState<Set<string>>(new Set());

  // ── aplicação (F6) ────────────────────────────────────────────────────────
  type AplicacaoStatus = 'idle' | 'confirmando' | 'aplicando' | 'relatorio';
  interface FalhaInfo {
    key: string; colaboradorId: string; nome: string; mes: string;
    horasSolicitadas: number; motivo: string;
    horasDisponiveis?: number; mesFechado?: boolean;
  }
  const [aplicacaoStatus,    setAplicacaoStatus]    = useState<AplicacaoStatus>('idle');
  const [aplicacaoProgresso, setAplicacaoProgresso] = useState({ atual: 0, total: 0 });
  const [celulaResultados,   setCelulaResultados]   = useState<Map<string, { ok: boolean; horasDisp?: number }>>(new Map());
  const [falhas,             setFalhas]             = useState<FalhaInfo[]>([]);

  // ── load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projetoId || !token) return;
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`/api/projetos/${projetoId}`,                   { headers: h }).then(r => r.ok ? r.json() : null),
      fetch(`/api/projetos/${projetoId}/macros`,            { headers: h }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projetos/${projetoId}/meta-apropriacao`,  { headers: h }).then(r => r.ok ? r.json() : null),
      fetch('/api/profissoes?ativo=true',                   { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/colaboradores?ativo=true',                { headers: h }).then(r => r.ok ? r.json() : []),
    ]).then(([proj, mac, meta, profs, cols]) => {
      setProjeto(proj);
      setMacros(mac ?? []);
      setMetaData(meta);
      setProfissoes(Array.isArray(profs) ? profs : []);
      // endpoint may return array or { data: [...] }
      setColabs(Array.isArray(cols) ? cols : (cols?.data ?? []));
    }).finally(() => setLoading(false));
  }, [projetoId, token]);

  // Troca de projeto → descarta resultado e reseta form (evita estado dessincronizado)
  useEffect(() => {
    setResultado(null);
    setErroMotor('');
    setMacroId('');
    setProfSel([]);
    setExcluidos([]);
    setFixados([]);
    setMaxExternos('');
  }, [projetoId]);

  // auto-select única macro
  useEffect(() => {
    if (macros.length === 1) setMacroId(macros[0]!.id);
  }, [macros]);

  // default meses = vigência com déficit > 0, não fechados
  useEffect(() => {
    if (metaData?.configurado) {
      const defaults = new Set(
        metaData.meses
          .filter(m => parseFloat(m.deficit) > 0 && !m.fechado)
          .slice(0, 12)
          .map(m => `${m.ano}-${String(m.mes).padStart(2, '0')}`),
      );
      setMesesSel(defaults);
    }
  }, [metaData]);

  // Mudança nos meses selecionados → descarta resultado obsoleto
  useEffect(() => {
    setResultado(null);
    setErroMotor('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesesSel]);

  // Novo resultado → descarta edições e estado de aplicação da rodada anterior
  useEffect(() => {
    setEdicoes(new Map());
    setRemovidos(new Set());
    setAplicacaoStatus('idle');
    setCelulaResultados(new Map());
    setFalhas([]);
  }, [resultado]);

  // ref para o container scrollável — permite voltar ao topo no Limpar
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── F5b: pivotar linhas → matriz por pessoa ──────────────────────────────
  const pessoasMatriz = useMemo<PessoaMatriz[]>(() => {
    if (!resultado || resultado.configurado === false) return [];
    const map = new Map<string, PessoaMatriz>();
    for (const l of resultado.linhas) {
      if (!map.has(l.colaboradorId)) {
        map.set(l.colaboradorId, {
          colaboradorId: l.colaboradorId,
          nome: l.nome, profissao: l.profissao, camada: l.camada,
          explicacao: l.explicacao, tarifa: l.tarifa,
          mesesData: new Map(),
        });
      }
      map.get(l.colaboradorId)!.mesesData.set(l.mes, {
        horasOriginal: l.horas,
        disponibilidadeVista: l.disponibilidadeVista,
      });
    }
    return Array.from(map.values());
  }, [resultado]);

  const mesesCol = useMemo(() => {
    if (!resultado || resultado.configurado === false) return [];
    return resultado.totaisPorMes.map(t => t.mes);
  }, [resultado]);

  // Recalcula totais por mês com as edições locais.
  // INVARIANTE: só os totais mudam — as outras linhas NÃO são recalculadas.
  const totaisEfetivos = useMemo(() => {
    if (!resultado || resultado.configurado === false) return resultado?.totaisPorMes ?? [];
    return resultado.totaisPorMes.map(t => {
      let coberto = 0;
      for (const p of pessoasMatriz) {
        if (removidos.has(p.colaboradorId)) continue;
        const orig = p.mesesData.get(t.mes)?.horasOriginal ?? 0;
        const h    = edicoes.get(p.colaboradorId)?.get(t.mes) ?? orig;
        coberto += h * parseFloat(p.tarifa);
      }
      const deficit = parseFloat(t.deficit);
      return {
        ...t,
        coberto:              coberto.toFixed(2),
        sobra:                Math.max(0, coberto - deficit).toFixed(2),
        deficitRemanescente:  Math.max(0, deficit - coberto).toFixed(2),
      };
    });
  }, [resultado, pessoasMatriz, edicoes, removidos]);

  const ageMins = resultado
    ? Math.floor((Date.now() - new Date(resultado.geradoEm).getTime()) / 60000)
    : 0;

  // Primeira micro (Geral) da macro destino — necessária para o POST /alocacoes
  const geralMicroId = useMemo(() => {
    const macro = macros.find(m => m.id === macroId);
    return macro?.microEntregas?.[0]?.id ?? null;
  }, [macros, macroId]);

  // Lista ordenada de células a aplicar: mes asc → camada → colaboradorId
  const ORDEM_CAMADA: Record<string, number> = { fixado: 0, equipe: 1, novo: 2 };
  const celulasFinal = useMemo(() => {
    const result: {
      key: string; colaboradorId: string; nome: string;
      camada: 'fixado' | 'equipe' | 'novo'; mes: string; ano: number; mesNum: number; horas: number;
    }[] = [];
    for (const p of pessoasMatriz) {
      if (removidos.has(p.colaboradorId)) continue;
      for (const m of mesesCol) {
        const orig  = p.mesesData.get(m)?.horasOriginal ?? 0;
        const horas = edicoes.get(p.colaboradorId)?.get(m) ?? orig;
        if (horas <= 0) continue;
        const [anoStr, mesStr] = m.split('-');
        result.push({
          key: `${p.colaboradorId}::${m}`,
          colaboradorId: p.colaboradorId, nome: p.nome, camada: p.camada,
          mes: m, ano: parseInt(anoStr!), mesNum: parseInt(mesStr!), horas,
        });
      }
    }
    return result.sort((a, b) => {
      if (a.mes !== b.mes) return a.mes.localeCompare(b.mes);
      const oc = (ORDEM_CAMADA[a.camada] ?? 99) - (ORDEM_CAMADA[b.camada] ?? 99);
      if (oc !== 0) return oc;
      return a.colaboradorId.localeCompare(b.colaboradorId);
    });
  }, [pessoasMatriz, mesesCol, edicoes, removidos]);

  // ── F6: aplicação ──────────────────────────────────────────────────────────
  async function executarAplicacao(celulas: typeof celulasFinal) {
    if (!projetoId || !macroId || !geralMicroId) return;
    setAplicacaoStatus('aplicando');
    setAplicacaoProgresso({ atual: 0, total: celulas.length });

    const novosResultados = new Map(celulaResultados);
    const novasFalhas: typeof falhas = [];

    for (let i = 0; i < celulas.length; i++) {
      const c = celulas[i]!;
      setAplicacaoProgresso({ atual: i + 1, total: celulas.length });
      try {
        const res = await fetch('/api/alocacoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            colaboradorId: c.colaboradorId, projetoId,
            macroEntregaId: macroId, microEntregaId: geralMicroId,
            ano: c.ano, mes: c.mesNum, horasPlanejadas: c.horas,
          }),
        });
        const data = await res.json();
        if (res.status === 201) {
          novosResultados.set(c.key, { ok: true });
        } else {
          let motivo = '';
          let horasDisp: number | undefined;
          let mesFechado = false;
          if (res.status === 409 && data.bloqueado) {
            horasDisp = parseFloat(data.horasDisponiveis);
            motivo    = `Teto de 220h — cabem ${horasDisp}h de ${c.horas}h solicitadas`;
          } else if (res.status === 409 && data.mesFechado) {
            motivo = 'Mês fechado'; mesFechado = true;
          } else if (res.status === 403) {
            motivo = data.error ?? 'Sem permissão';
          } else {
            motivo = data.error ?? `Erro ${res.status}`;
          }
          novosResultados.set(c.key, { ok: false, horasDisp });
          novasFalhas.push({ key: c.key, colaboradorId: c.colaboradorId, nome: c.nome, mes: c.mes, horasSolicitadas: c.horas, motivo, horasDisponiveis: horasDisp, mesFechado });
        }
      } catch {
        novosResultados.set(c.key, { ok: false });
        novasFalhas.push({ key: c.key, colaboradorId: c.colaboradorId, nome: c.nome, mes: c.mes, horasSolicitadas: c.horas, motivo: 'Erro de rede' });
      }
      setCelulaResultados(new Map(novosResultados));
    }
    setFalhas(novasFalhas);
    setAplicacaoStatus('relatorio');
  }

  function ajustarHorasDisp(colaboradorId: string, mes: string, horasDisp: number) {
    setEdicoes(prev => {
      const next = new Map(prev);
      const mm   = new Map(next.get(colaboradorId) ?? []);
      mm.set(mes, horasDisp);
      next.set(colaboradorId, mm);
      return next;
    });
    const key = `${colaboradorId}::${mes}`;
    setCelulaResultados(prev => { const n = new Map(prev); n.delete(key); return n; });
    setFalhas(prev => prev.filter(f => f.key !== key));
  }

  // ── gerar ─────────────────────────────────────────────────────────────────
  async function handleGerar(e: React.FormEvent) {
    e.preventDefault();
    setGerando(true);
    setErroMotor('');
    setResultado(null);

    const body: Record<string, unknown> = {
      meses:          [...mesesSel].sort(),
      minHorasNovo:   parseInt(minHorasNovo)   || 8,
      maxHorasPessoa: parseInt(maxHorasPessoa) || 60,
    };
    if (profSel.length  > 0) body.profissoes = profSel;
    if (excluidos.length > 0) body.excluidos  = excluidos.map(e => e.id);
    if (fixados.length   > 0) body.fixados    = fixados.map(f => ({
      colaboradorId: f.id,
      ...(f.minHoras ? { minHoras: parseInt(f.minHoras) } : {}),
    }));
    if (maxExternos) body.maxExternos = parseInt(maxExternos);

    try {
      const res  = await fetch(`/api/projetos/${projetoId}/sugestao-equipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) setErroMotor(data.error ?? `Erro ${res.status}`);
      else         setResultado(data);
    } catch {
      setErroMotor('Erro de rede');
    } finally {
      setGerando(false);
    }
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const mesesVig     = metaData?.configurado ? metaData.meses : [];
  const temDeficit   = mesesVig.some(m => parseFloat(m.deficit) > 0);
  const exclSet      = new Set(excluidos.map(e => e.id));
  const fixSet       = new Set(fixados.map(f => f.id));
  const profSelSet   = new Set(profSel);

  const canGerar = macros.length > 0 && !!macroId && mesesSel.size > 0 && mesesSel.size <= 12;

  const profOpts  = profissoes.filter(p => !profSelSet.has(p.id)).map(p => ({ id: p.id, nome: p.nome }));
  const exclOpts  = colabs.filter(c => !exclSet.has(c.id) && !fixSet.has(c.id)).map(c => ({ id: c.id, nome: c.nome }));
  const fixOpts   = colabs.filter(c => !exclSet.has(c.id) && !fixSet.has(c.id)).map(c => ({ id: c.id, nome: c.nome }));

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full gap-2" style={{ color: 'var(--text-3)' }}>
      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      Carregando…
    </div>
  );

  if (!projeto) return <div className="p-6" style={{ color: 'var(--text-3)' }}>Projeto não encontrado.</div>;

  if (metaData && !metaData.configurado) return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl">
      <button onClick={() => navigate(`/projetos/${projetoId}`)}
        className="flex items-center gap-1.5 text-xs"
        style={{ color: 'var(--text-3)' }}>
        <ArrowLeft size={13} /> {projeto.codigo} — {projeto.nome}
      </button>
      <div className="flex flex-col items-center py-12 gap-3 rounded-2xl"
        style={{ border: '1px dashed var(--border)', color: 'var(--text-3)' }}>
        <BarChart2 size={36} strokeWidth={1} />
        <p className="text-base font-semibold" style={{ color: 'var(--text-2)' }}>Projeto não configurado</p>
        <p className="text-sm text-center px-8">Configure a vigência e os valores do projeto para planejar a equipe.</p>
        <button onClick={() => navigate(`/projetos/${projetoId}`)}
          className="mt-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--brand-500)' }}>
          Ir para o projeto
        </button>
      </div>
    </div>
  );

  return (
    <div ref={scrollRef} className="p-6 flex flex-col gap-6 h-full overflow-y-auto">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => navigate(`/projetos/${projetoId}`)}
          className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
          style={{ color: 'var(--text-3)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
        >
          <ArrowLeft size={13} /> {projeto.codigo} — {projeto.nome}
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--brand-500)15', border: '1px solid var(--brand-500)30' }}>
            <Brain size={18} style={{ color: 'var(--brand-500)' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Planejar Equipe</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              Sugestão automática de alocação — {projeto.codigo}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ── COLUNA ESQUERDA: cobertura + formulário ─────────────────── */}
        <div className="flex flex-col gap-4" style={{ width: '100%', maxWidth: 400 }}>

          {/* Cobertura */}
          {metaData?.configurado && (
            <div style={card}>
              <p className="flex items-center gap-1.5 mb-3" style={secLabel}>
                <BarChart2 size={11} /> Cobertura do período
              </p>
              {!temDeficit ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
                  style={{ background: 'hsl(142 71% 45% / 0.1)', color: 'hsl(142 60% 38%)', border: '1px solid hsl(142 71% 45% / 0.2)' }}>
                  <Check size={13} className="shrink-0" />
                  Nenhum déficit no período — o projeto já está coberto.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thSt}>Mês</th>
                        <th style={{ ...thSt, textAlign: 'right' }}>Meta HT</th>
                        <th style={{ ...thSt, textAlign: 'right' }}>Déficit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metaData.meses.map(m => {
                        const key = `${m.ano}-${String(m.mes).padStart(2, '0')}`;
                        const def = parseFloat(m.deficit);
                        return (
                          <tr key={key}>
                            <td style={tdSt}>
                              <div className="flex items-center gap-1">
                                {fmtMes(key)}
                                {m.fechado && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                    style={{ background: 'hsl(0 0% 50% / 0.12)', color: 'var(--text-3)' }}>
                                    fechado
                                  </span>
                                )}
                                {m.pinado && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                    style={{ background: 'var(--brand-500)15', color: 'var(--brand-500)' }}>
                                    pin
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ ...tdSt, textAlign: 'right' }}>{fmtMoeda(m.metaHT)}</td>
                            <td style={{
                              ...tdSt, textAlign: 'right',
                              color: def > 0 ? '#f87171' : 'var(--text-3)',
                              fontWeight: def > 0 ? 600 : undefined,
                            }}>
                              {def > 0 ? fmtMoeda(m.deficit) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Formulário de parâmetros */}
          <form onSubmit={handleGerar} className="flex flex-col gap-3">
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* ── Macro destino ─────────────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 8 }}>Macro-entrega destino *</p>
                {macros.length === 0 ? (
                  <div className="flex flex-col gap-2.5 p-3 rounded-xl"
                    style={{ background: 'hsl(38 92% 50% / 0.08)', border: '1px solid hsl(38 92% 50% / 0.25)' }}>
                    <div className="flex items-center gap-2 text-xs font-semibold"
                      style={{ color: 'hsl(38 92% 42%)' }}>
                      <AlertTriangle size={13} />
                      Este projeto ainda não tem uma macro-entrega.
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      Crie uma macro-entrega para poder planejar a equipe.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate(`/projetos/${projetoId}`)}
                      className="self-start text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                      style={{ background: 'var(--brand-500)' }}
                    >
                      Criar macro-entrega
                    </button>
                  </div>
                ) : (
                  <select
                    value={macroId}
                    onChange={e => setMacroId(e.target.value)}
                    required
                    style={{ ...inp, cursor: 'pointer' }}
                  >
                    {macros.length > 1 && <option value="">Selecione uma macro…</option>}
                    {macros.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                )}
              </div>

              {/* ── Período ───────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p style={secLabel}>
                    Período
                    {mesesVig.length > 0 && (
                      <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, color: mesesSel.size >= 12 ? 'hsl(38 92% 42%)' : 'var(--text-3)' }}>
                        {mesesSel.size}/12
                      </span>
                    )}
                  </p>
                  {mesesVig.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMesesSel(new Set(
                          mesesVig.filter(m => !m.fechado)
                            .slice(0, 12)
                            .map(m => `${m.ano}-${String(m.mes).padStart(2, '0')}`)
                        ))}
                        className="text-xs font-medium transition-colors"
                        style={{ color: 'var(--brand-500)' }}
                      >
                        Todos
                      </button>
                      <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
                      <button
                        type="button"
                        onClick={() => {
                          setMesesSel(new Set());
                          scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="text-xs font-medium transition-colors"
                        style={{ color: 'var(--text-3)' }}
                      >
                        Limpar
                      </button>
                    </div>
                  )}
                </div>
                {mesesVig.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>Sem meses na vigência.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5" style={{ maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                    {mesesVig.map(m => {
                      const key     = `${m.ano}-${String(m.mes).padStart(2, '0')}`;
                      const def     = parseFloat(m.deficit);
                      const checked = mesesSel.has(key);
                      return (
                        <label
                          key={key}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg select-none text-xs font-semibold transition-all"
                          style={{
                            background: m.fechado
                              ? 'var(--surface-2)'
                              : checked
                                ? 'var(--brand-500)'
                                : 'var(--surface-2)',
                            border: m.fechado
                              ? '1px solid var(--border)'
                              : checked
                                ? '1px solid var(--brand-500)'
                                : '1px dashed var(--border)',
                            color: m.fechado
                              ? 'var(--text-3)'
                              : checked
                                ? 'white'
                                : 'var(--text-2)',
                            opacity: m.fechado ? 0.45 : 1,
                            cursor: m.fechado ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            disabled={m.fechado}
                            onChange={ev => setMesesSel(prev => {
                              const next = new Set(prev);
                              if (ev.target.checked) {
                                if (next.size >= 12) return prev;
                                next.add(key);
                              } else {
                                next.delete(key);
                              }
                              return next;
                            })}
                          />
                          {fmtMes(key)}
                          {def > 0 && (
                            <span style={{
                              fontWeight: 700,
                              color: checked ? 'rgba(255,255,255,0.75)' : '#f87171',
                              fontSize: 10,
                            }}>
                              {fmtMoeda(def)}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Profissões ────────────────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 6 }}>Sugerir apenas estas profissões (opcional)</p>
                <p className="text-xs mb-2" style={{ color: 'var(--text-3)' }}>
                  Deixe vazio para considerar todas as profissões.
                </p>
                <div className="flex flex-col gap-2">
                  {profSel.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {profSel.map(pid => {
                        const p = profissoes.find(x => x.id === pid);
                        return p ? (
                          <Tag key={pid} label={p.nome}
                            onRemove={() => setProfSel(prev => prev.filter(x => x !== pid))} />
                        ) : null;
                      })}
                    </div>
                  )}
                  {profOpts.length > 0 && (
                    <Combobox
                      key={profKey}
                      options={profOpts}
                      value=""
                      onChange={id => { setProfSel(p => [...p, id]); setProfKey(k => k + 1); }}
                      placeholder="Adicionar profissão…"
                      showIcon
                    />
                  )}
                </div>
              </div>

              {/* ── Excluir colaboradores ─────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 8 }}>Excluir colaboradores</p>
                <div className="flex flex-col gap-2">
                  {excluidos.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {excluidos.map(e => (
                        <Tag key={e.id} label={e.nome}
                          onRemove={() => setExcluidos(prev => prev.filter(x => x.id !== e.id))} />
                      ))}
                    </div>
                  )}
                  <Combobox
                    key={exclKey}
                    options={exclOpts}
                    value=""
                    onChange={id => {
                      const c = colabs.find(x => x.id === id);
                      if (c) setExcluidos(p => [...p, { id: c.id, nome: c.nome }]);
                      setExclKey(k => k + 1);
                    }}
                    placeholder="Buscar e excluir…"
                    showIcon
                  />
                </div>
              </div>

              {/* ── Fixar colaboradores ───────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 8 }}>Fixar colaboradores</p>
                <div className="flex flex-col gap-2">
                  {fixados.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {fixados.map(f => (
                        <div key={f.id} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                          <span className="flex-1 text-sm truncate" style={{ color: 'var(--text-1)' }}>
                            {f.nome}
                          </span>
                          <input
                            type="number" min={0} step={4}
                            value={f.minHoras}
                            onChange={e => setFixados(prev =>
                              prev.map(x => x.id === f.id ? { ...x, minHoras: e.target.value } : x)
                            )}
                            placeholder="min h"
                            title="Mínimo de horas (opcional)"
                            style={{ ...inp, width: 80, padding: '4px 8px', fontSize: 12 }}
                          />
                          <button type="button"
                            onClick={() => setFixados(prev => prev.filter(x => x.id !== f.id))}
                            style={{ color: 'var(--text-3)', cursor: 'pointer' }}>
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Combobox
                    key={fixKey}
                    options={fixOpts}
                    value=""
                    onChange={id => {
                      const c = colabs.find(x => x.id === id);
                      if (c) setFixados(p => [...p, { id: c.id, nome: c.nome, minHoras: '' }]);
                      setFixKey(k => k + 1);
                    }}
                    placeholder="Buscar e fixar…"
                    showIcon
                  />
                </div>
              </div>

              {/* ── Máx. novos externos ───────────────────────── */}
              <div>
                <p style={{ ...secLabel, marginBottom: 4 }}>Máximo de novos externos</p>
                <input
                  type="number" min={0}
                  value={maxExternos}
                  onChange={e => setMaxExternos(e.target.value)}
                  placeholder="Sem limite"
                  style={{ ...inp, width: 160 }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  IDs distintos com camada "novo" em toda a execução.
                </p>
              </div>

              {/* ── Avançados ─────────────────────────────────── */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAvancados(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: 'var(--text-3)' }}
                >
                  {showAvancados ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  Opções avançadas <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opcionais — já têm padrão)</span>
                </button>
                {showAvancados && (
                  <div className="flex gap-4 mt-3">
                    <div className="flex-1">
                      <p style={{ ...secLabel, marginBottom: 4 }}>Mínimo para novo entrante</p>
                      <input type="number" min={1} step={1} value={minHorasNovo}
                        onChange={e => setMinHorasNovo(e.target.value)} style={inp}
                        placeholder="8" />
                      <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                        Horas mínimas para trazer alguém <em>novo</em> ao projeto — abaixo disso o custo de integração não compensa. Não se aplica a quem já está no time. Padrão: 8h.
                      </p>
                    </div>
                    <div className="flex-1">
                      <p style={{ ...secLabel, marginBottom: 4 }}>Máximo por pessoa / mês</p>
                      <input type="number" min={1} step={1} value={maxHorasPessoa}
                        onChange={e => setMaxHorasPessoa(e.target.value)} style={inp}
                        placeholder="60" />
                      <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                        Teto de horas que o motor pode alocar a uma pessoa neste projeto por mês — evita concentrar tudo numa só. Padrão: 60h.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* erro do motor */}
            {erroMotor && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm"
                style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 62%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>
                <AlertTriangle size={14} className="shrink-0" /> {erroMotor}
              </div>
            )}

            {/* Gerar */}
            <button
              type="submit"
              disabled={!canGerar || gerando}
              className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity"
              style={{
                background: canGerar ? 'var(--brand-500)' : 'var(--surface-3)',
                color:  canGerar ? 'white' : 'var(--text-3)',
                cursor: canGerar && !gerando ? 'pointer' : 'not-allowed',
                opacity: gerando ? 0.7 : 1,
                border: canGerar ? 'none' : '1px solid var(--border)',
              }}
            >
              {gerando ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                    <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Executando motor…
                </>
              ) : (
                <><Zap size={15} /> Gerar sugestão</>
              )}
            </button>

            {!macroId && macros.length > 0 && (
              <p className="text-xs text-center -mt-1" style={{ color: 'var(--text-3)' }}>
                Selecione uma macro-entrega para continuar.
              </p>
            )}
            {mesesSel.size === 0 && macros.length > 0 && (
              <p className="text-xs text-center -mt-1 font-medium" style={{ color: 'hsl(38 92% 42%)' }}>
                Selecione ao menos um mês do período.
              </p>
            )}
            {mesesSel.size === 12 && (
              <p className="text-xs text-center -mt-1" style={{ color: 'hsl(38 92% 42%)' }}>
                Limite de 12 meses atingido — máximo por rodada do motor.
              </p>
            )}
          </form>
        </div>

        {/* ── COLUNA DIREITA: resultado ──────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!resultado && !gerando && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-2xl"
              style={{ border: '1px dashed var(--border)', color: 'var(--text-3)' }}>
              <Brain size={40} strokeWidth={1} />
              <p className="text-sm">Configure os parâmetros e clique em Gerar sugestão.</p>
            </div>
          )}

          {gerando && (
            <div className="flex items-center justify-center py-20 gap-2" style={{ color: 'var(--text-3)' }}>
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Executando motor de sugestão…
            </div>
          )}

          {resultado && resultado.configurado === false && (
            <div className="flex flex-col items-center py-10 gap-2" style={{ color: 'var(--text-3)' }}>
              <AlertTriangle size={28} strokeWidth={1} />
              <p className="text-sm">O projeto não está configurado para o motor de sugestões.</p>
            </div>
          )}

          {resultado && resultado.configurado !== false && (
            <>
              {/* Avisos */}
              {resultado.avisos.length > 0 && (
                <div style={card} className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5" style={secLabel}>
                    <Info size={11} /> Avisos
                  </p>
                  {resultado.avisos.map((a, i) => (
                    <div key={i} className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: 'hsl(38 92% 50% / 0.08)', color: 'hsl(38 92% 42%)', border: '1px solid hsl(38 92% 50% / 0.18)' }}>
                      {a}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Matriz de revisão (F5b) ─────────────────────────────── */}
              <div style={card}>
                {/* Cabeçalho do card */}
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <p style={secLabel}>
                      Matriz de equipe —{' '}
                      {pessoasMatriz.filter(p => !removidos.has(p.colaboradorId)).length} pessoa
                      {pessoasMatriz.filter(p => !removidos.has(p.colaboradorId)).length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: ageMins > 5 ? 'hsl(38 92% 42%)' : 'var(--text-3)' }}>
                      Sugestão gerada {ageMins === 0 ? 'agora mesmo' : `há ${ageMins} min`}
                      {ageMins > 5 && ' · disponibilidade pode ter mudado'}
                    </p>
                  </div>
                  {aplicacaoStatus === 'aplicando' ? (
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                        <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Aplicando {aplicacaoProgresso.atual} de {aplicacaoProgresso.total}…
                    </div>
                  ) : (
                    <button
                      disabled={celulasFinal.length === 0 || !geralMicroId || aplicacaoStatus !== 'idle'}
                      onClick={() => setAplicacaoStatus('confirmando')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity"
                      style={{
                        background: celulasFinal.length > 0 && geralMicroId && aplicacaoStatus === 'idle' ? 'var(--brand-500)' : 'var(--surface-3)',
                        border: celulasFinal.length > 0 && geralMicroId && aplicacaoStatus === 'idle' ? 'none' : '1px solid var(--border)',
                        color: celulasFinal.length > 0 && geralMicroId && aplicacaoStatus === 'idle' ? 'white' : 'var(--text-3)',
                        cursor: celulasFinal.length > 0 && geralMicroId && aplicacaoStatus === 'idle' ? 'pointer' : 'not-allowed',
                        opacity: aplicacaoStatus === 'relatorio' ? 0.45 : 1,
                      }}
                    >
                      <Check size={12} /> Aplicar alocações
                    </button>
                  )}
                </div>

                {pessoasMatriz.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-2" style={{ color: 'var(--text-3)' }}>
                    <AlertTriangle size={24} strokeWidth={1} />
                    <p className="text-sm">Nenhuma sugestão gerada.</p>
                    <p className="text-xs">Verifique as tarifas dos candidatos e os parâmetros.</p>
                  </div>
                ) : pessoasMatriz.filter(p => !removidos.has(p.colaboradorId)).length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-2" style={{ color: 'var(--text-3)' }}>
                    <X size={24} strokeWidth={1} />
                    <p className="text-sm">Todas as pessoas foram removidas.</p>
                    <button
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)', cursor: 'pointer' }}
                      onClick={() => setRemovidos(new Set())}
                    >
                      Restaurar todas
                    </button>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                      {/* ── Cabeçalho ─────────────────────────────── */}
                      <thead>
                        <tr>
                          <th style={{ ...thSt, position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface-1)', minWidth: 210, maxWidth: 210 }}>
                            Colaborador
                          </th>
                          {mesesCol.map(m => (
                            <th key={m} style={{ ...thSt, textAlign: 'right', minWidth: 72, width: 72 }}>
                              {fmtMes(m)}
                            </th>
                          ))}
                          <th style={{ ...thSt, textAlign: 'right', minWidth: 64 }}>Total h</th>
                          <th style={{ ...thSt, textAlign: 'right', minWidth: 100 }}>Receita</th>
                          <th style={{ ...thSt, width: 32 }} />
                        </tr>
                      </thead>

                      {/* ── Linhas por pessoa ─────────────────────── */}
                      <tbody>
                        {pessoasMatriz.filter(p => !removidos.has(p.colaboradorId)).map(p => {
                          let totalHoras   = 0;
                          let totalReceita = 0;
                          mesesCol.forEach(m => {
                            const orig = p.mesesData.get(m)?.horasOriginal ?? 0;
                            const h    = edicoes.get(p.colaboradorId)?.get(m) ?? orig;
                            totalHoras   += h;
                            totalReceita += h * parseFloat(p.tarifa);
                          });

                          return (
                            <tr key={p.colaboradorId} style={{ borderBottom: '1px solid var(--border)' }}>
                              {/* Pessoa info — sticky */}
                              <td style={{ ...tdSt, borderBottom: 'none', position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface-1)', minWidth: 210, maxWidth: 210, whiteSpace: 'normal' }}>
                                <div className="flex items-start gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div style={{ fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.3 }}>{p.nome}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{p.profissao || '—'}</div>
                                  </div>
                                  <CamadaBadge camada={p.camada} />
                                </div>
                              </td>

                              {/* Células de horas por mês */}
                              {mesesCol.map(m => {
                                const mesData  = p.mesesData.get(m);
                                const orig     = mesData?.horasOriginal ?? 0;
                                const horas    = edicoes.get(p.colaboradorId)?.get(m) ?? orig;
                                const dispApos = mesData ? mesData.disponibilidadeVista - horas : null;
                                const aviso    = dispApos !== null && dispApos < 20;
                                const cellKey  = `${p.colaboradorId}::${m}`;
                                const celRes   = celulaResultados.get(cellKey);
                                const celOk    = celRes?.ok === true;
                                const celFalha = celRes?.ok === false;

                                let bgColor = aviso ? 'hsl(38 92% 50% / 0.08)' : 'var(--surface-2)';
                                let border  = `1px solid ${aviso ? 'hsl(38 92% 50% / 0.45)' : 'var(--border)'}`;
                                if (celOk)    { bgColor = 'hsl(142 71% 45% / 0.10)'; border = '1px solid hsl(142 71% 45% / 0.35)'; }
                                if (celFalha) { bgColor = 'hsl(0 85% 60% / 0.08)';   border = '1px solid hsl(0 85% 60% / 0.45)'; }

                                return (
                                  <td key={m} style={{ ...tdSt, borderBottom: 'none', textAlign: 'right', padding: '6px 4px', verticalAlign: 'middle' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                                      {celOk ? (
                                        <div style={{ width: 56, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, borderRadius: 6, padding: '3px 6px', background: bgColor, border }}>
                                          <Check size={11} style={{ color: 'hsl(142 60% 38%)' }} />
                                          <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(142 60% 38%)' }}>{horas}h</span>
                                        </div>
                                      ) : (
                                        <input
                                          type="number"
                                          min={0}
                                          value={horas === 0 ? '' : horas}
                                          placeholder="0"
                                          disabled={aplicacaoStatus === 'aplicando'}
                                          onChange={ev => {
                                            const val = Math.max(0, parseFloat(ev.target.value) || 0);
                                            setEdicoes(prev => {
                                              const next    = new Map(prev);
                                              const mesMapa = new Map(next.get(p.colaboradorId) ?? []);
                                              mesMapa.set(m, val);
                                              next.set(p.colaboradorId, mesMapa);
                                              return next;
                                            });
                                            // limpar resultado de falha ao editar
                                            if (celFalha) {
                                              setCelulaResultados(prev => { const n = new Map(prev); n.delete(cellKey); return n; });
                                              setFalhas(prev => prev.filter(f => f.key !== cellKey));
                                            }
                                          }}
                                          style={{
                                            width: 56, textAlign: 'right', fontSize: 13, fontWeight: 600,
                                            background: bgColor, border, borderRadius: 6, padding: '3px 6px',
                                            color: celFalha ? 'hsl(0 85% 62%)' : 'var(--text-1)', outline: 'none',
                                            opacity: aplicacaoStatus === 'aplicando' ? 0.5 : 1,
                                          }}
                                        />
                                      )}
                                      {!celOk && dispApos !== null && (
                                        <span style={{ fontSize: 9, lineHeight: 1, color: aviso ? 'hsl(38 92% 42%)' : 'var(--text-3)' }}>
                                          {aviso && '⚠ '}{Math.round(dispApos)}h livres
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}

                              {/* Total horas */}
                              <td style={{ ...tdSt, borderBottom: 'none', textAlign: 'right', fontWeight: 600 }}>
                                {totalHoras}h
                              </td>
                              {/* Total receita */}
                              <td style={{ ...tdSt, borderBottom: 'none', textAlign: 'right', fontWeight: 600, color: 'hsl(142 60% 38%)' }}>
                                {fmtMoeda(totalReceita)}
                              </td>
                              {/* Remover */}
                              <td style={{ ...tdSt, borderBottom: 'none', padding: '4px 8px', textAlign: 'center' }}>
                                <button
                                  onClick={() => setRemovidos(prev => new Set([...prev, p.colaboradorId]))}
                                  title="Remover desta sugestão"
                                  style={{ color: 'var(--text-3)', cursor: 'pointer', lineHeight: 1 }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
                                >
                                  <X size={13} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>

                      {/* ── Rodapé: totais por mês ────────────────── */}
                      <tfoot>
                        <tr style={{ borderTop: '2px solid var(--border)' }}>
                          <td style={{ ...tdSt, position: 'sticky', left: 0, background: 'var(--surface-1)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-3)' }}>
                            Meta HT
                          </td>
                          {totaisEfetivos.map(t => (
                            <td key={t.mes} style={{ ...tdSt, textAlign: 'right', fontWeight: 600 }}>
                              {fmtMoeda(t.metaHT)}
                            </td>
                          ))}
                          <td colSpan={3} />
                        </tr>
                        <tr>
                          <td style={{ ...tdSt, position: 'sticky', left: 0, background: 'var(--surface-1)', fontSize: 11, fontWeight: 700, color: 'hsl(142 60% 38%)' }}>
                            Coberto
                          </td>
                          {totaisEfetivos.map(t => (
                            <td key={t.mes} style={{ ...tdSt, textAlign: 'right', fontWeight: 600, color: 'hsl(142 60% 38%)' }}>
                              {fmtMoeda(t.coberto)}
                            </td>
                          ))}
                          <td colSpan={3} />
                        </tr>
                        <tr>
                          <td style={{ ...tdSt, position: 'sticky', left: 0, background: 'var(--surface-1)', fontSize: 11, fontWeight: 700, color: 'var(--text-3)' }}>
                            Déficit rem.
                          </td>
                          {totaisEfetivos.map(t => {
                            const rem = parseFloat(t.deficitRemanescente);
                            return (
                              <td key={t.mes} style={{ ...tdSt, textAlign: 'right', fontWeight: rem > 0 ? 600 : undefined, color: rem > 0 ? '#f87171' : 'var(--text-3)' }}>
                                {rem > 0 ? fmtMoeda(t.deficitRemanescente) : '—'}
                              </td>
                            );
                          })}
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Relatório de aplicação (F6) ───────────────────────── */}
              {aplicacaoStatus === 'relatorio' && (() => {
                const totalAplicado = celulasFinal.length - falhas.length;
                const totalCelulas  = celulasFinal.length;
                const tudoOk        = falhas.length === 0;
                return (
                  <div style={{ ...card, border: tudoOk ? '1px solid hsl(142 71% 45% / 0.35)' : '1px solid hsl(0 85% 60% / 0.25)' }}>
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div>
                        <p style={secLabel}>Resultado da aplicação</p>
                        <p className="text-sm font-semibold mt-0.5" style={{ color: tudoOk ? 'hsl(142 60% 38%)' : 'var(--text-1)' }}>
                          {tudoOk
                            ? `Todas as ${totalCelulas} alocações foram aplicadas com sucesso.`
                            : `${totalAplicado} de ${totalCelulas} alocações aplicadas — ${falhas.length} falha${falhas.length !== 1 ? 's' : ''}.`}
                        </p>
                      </div>
                      <button
                        onClick={() => navigate(`/projetos/${projetoId}`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'var(--brand-500)', color: 'white', cursor: 'pointer', border: 'none' }}
                      >
                        <ArrowLeft size={12} /> Ir para o projeto
                      </button>
                    </div>

                    {falhas.length > 0 && (
                      <div className="flex flex-col gap-1.5 mt-2">
                        {falhas.map(f => (
                          <div key={f.key} className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl"
                            style={{ background: 'hsl(0 85% 60% / 0.06)', border: '1px solid hsl(0 85% 60% / 0.15)' }}>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                                {f.nome} — {fmtMes(f.mes)}
                              </span>
                              <span className="text-xs ml-2" style={{ color: 'hsl(0 85% 62%)' }}>{f.motivo}</span>
                            </div>
                            {f.horasDisponiveis !== undefined && f.horasDisponiveis > 0 && (
                              <button
                                onClick={() => ajustarHorasDisp(f.colaboradorId, f.mes, f.horasDisponiveis!)}
                                className="shrink-0 text-xs font-semibold px-2 py-1 rounded-lg"
                                style={{ background: 'hsl(0 85% 60% / 0.12)', border: '1px solid hsl(0 85% 60% / 0.25)', color: 'hsl(0 85% 62%)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                → {f.horasDisponiveis}h
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const chavesFalha = new Set(falhas.map(f => f.key));
                            executarAplicacao(celulasFinal.filter(c => chavesFalha.has(c.key)));
                          }}
                          className="self-start flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)', cursor: 'pointer' }}
                        >
                          <Zap size={11} /> Reaplicar {falhas.length} falha{falhas.length !== 1 ? 's' : ''}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Remanescentes */}
              {resultado.remanescentes.length > 0 && (
                <div style={card}>
                  <p className="flex items-center gap-1.5 mb-3" style={secLabel}>
                    <AlertTriangle size={11} /> Meses com déficit remanescente
                  </p>
                  <div className="flex flex-col gap-2">
                    {resultado.remanescentes.map(r => (
                      <div key={r.mes} className="px-3 py-2.5 rounded-xl"
                        style={{ background: 'hsl(0 85% 60% / 0.06)', border: '1px solid hsl(0 85% 60% / 0.15)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                            {fmtMes(r.mes)}
                          </span>
                          <span className="text-xs font-bold" style={{ color: '#f87171' }}>
                            {fmtMoeda(r.valor)} não cobertos
                          </span>
                        </div>
                        {r.diagnostico.map((d, i) => (
                          <p key={i} className="text-xs" style={{ color: 'var(--text-3)' }}>· {d}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Modal de confirmação (F6) ─────────────────────────────────────── */}
      {aplicacaoStatus === 'confirmando' && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setAplicacaoStatus('idle')}
        >
          <div
            style={{ ...card, maxWidth: 440, width: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <p style={{ ...secLabel, marginBottom: 8 }}>Confirmar aplicação</p>
            <p className="text-sm mb-1" style={{ color: 'var(--text-1)', fontWeight: 600 }}>
              Aplicar {celulasFinal.length} alocação{celulasFinal.length !== 1 ? 'ões' : ''} ao projeto {projeto?.codigo}?
            </p>
            <p className="text-xs mb-5" style={{ color: 'var(--text-3)' }}>
              As horas serão gravadas no banco passando pelo teto de 220h por colaborador.
              O que for bem-sucedido não tem rollback automático.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAplicacaoStatus('idle')}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={() => executarAplicacao(celulasFinal)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--brand-500)', cursor: 'pointer', border: 'none' }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
