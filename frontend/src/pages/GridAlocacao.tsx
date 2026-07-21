import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useGestorFiltro } from '../context/GestorFiltroContext';
import { LayoutGrid, ChevronLeft, ChevronRight, Search, List, X, AlertTriangle } from 'lucide-react';
import Combobox from '../components/Combobox';
import SeletorGestor from '../components/SeletorGestor';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface ProjetoCol {
  id: string;
  codigo: string;
  nome: string;
  gestorId: string;
  defaultMacroId: string | null;
  defaultMicroId: string | null;
  vigenciaInicio: string | null;
  vigenciaFim:    string | null;
}

// Uma alocação individual dentro de uma célula (uma macro/micro específica)
interface CelulaDetalhe {
  alocacaoId:      string;
  macroNome:       string;
  microNome:       string;
  macroEntregaId:  string;
  microEntregaId:  string;
  horas:           string;
  horasRealizadas: string | null;
}

// Dados de uma célula: total do projeto + composição por macro/micro
// null quando o colaborador não tem nenhuma alocação naquele projeto
type CelulaData = {
  totalHoras:     string;
  totalRealizado: string | null;
  detalhes:       CelulaDetalhe[];
} | null;

interface Saldo {
  totalMeusProj: string;
  totalOutros:   string;
  totalGeral:    string;
  disponivel:    string;
  custo:         string | null;
}

interface Linha {
  colaborador: { id: string; nome: string; profissao: { id: string; nome: string } | null };
  saldo: Saldo;
  celulas: Record<string, CelulaData>;
}

interface GridData {
  projetos: ProjetoCol[];
  linhas:   Linha[];
  fechado:  boolean;
  custoPorProjeto: Record<string, string | null>;
}

// Info passada para o drawer ao abrir
interface DrawerInfo {
  colabId:    string;
  colabNome:  string;
  projetoId:  string;
  projCodigo: string;
  projNome:   string;
  celula:     CelulaData;
  saldo:      Saldo;
  ano:        number;
  mes:        number;
}

// Estrutura completa do projeto (macros + todas as micros, inclusive sem alocação)
interface MacroEstrutura {
  id:            string;
  nome:          string;
  microEntregas: { id: string; nome: string }[];
}

interface BloqueioInfo {
  totalAlocado:     string;
  horasSolicitadas: string;
  horasDisponiveis: string;
  distribuicao: {
    projetoCodigo: string;
    projetoNome:   string;
    gestorNome:    string;
    horas:         string;
  }[];
}

// Colaborador adicionado manualmente ao grid (ainda sem alocação nos meus projetos)
interface ExtraLinha {
  colaborador: { id: string; nome: string; profissao: { id: string; nome: string } | null };
  saldo: Saldo;
}

// Candidato — resposta de GET /alocacoes/candidatos (faixa abaixo do grid)
interface Candidato {
  id: string;
  nome: string;
  email: string;
  profissao: { id: string; nome: string } | null;
  totalAlocado: string;
  disponivel: string;
  valorHora: string | null;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const TETO = 220;

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const COL_COLAB_W = 200;
const COL_SALDO_W = 260;
const COL_PROJ_W  = 130;

// ── Helpers ──────────────────────────────────────────────────────────────────

function corSaldo(pct: number): string {
  if (pct >= 100) return '#ef4444';
  if (pct >= 80)  return '#f59e0b';
  return '#22c55e';
}

function fmtHoras(h: string | number): string {
  const n = parseFloat(String(h));
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function fmtMoeda(v: string): string {
  return parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Barra de saldo ────────────────────────────────────────────────────────────
// COR  = lotação total (verde/âmbar/vermelho) — mesma cor para sólido e hatch.
// TEXTURA = sólido (minhas horas) · hachurado 45° (outros gestores).
// FUNDO   = var(--surface-3) inequivocamente vazio.

function BarraSaldo({ saldo }: { saldo: Saldo }) {
  const totalG = parseFloat(saldo.totalGeral);
  const meus   = parseFloat(saldo.totalMeusProj);
  const outros = parseFloat(saldo.totalOutros);
  const disp   = parseFloat(saldo.disponivel);

  const pctTotal  = Math.min((totalG / TETO) * 100, 100);
  const pctMeus   = Math.min((meus   / TETO) * 100, pctTotal);
  const pctOutros = Math.min((outros / TETO) * 100, Math.max(0, pctTotal - pctMeus));

  const cor   = corSaldo((totalG / TETO) * 100);
  const hatch = `repeating-linear-gradient(45deg,${cor},${cor} 3px,transparent 3px,transparent 8px)`;
  const tooltip = `Você: ${fmtHoras(meus)}h · Outros: ${fmtHoras(outros)}h · Disponível: ${fmtHoras(disp)}h`;

  return (
    <div className="flex items-center gap-2 min-w-0 w-full" title={tooltip}>
      <div style={{ position: 'relative', flex: 1, height: 8, borderRadius: 9999, overflow: 'hidden', background: 'var(--surface-3)', minWidth: 80 }}>
        {pctOutros > 0 && (
          <div style={{ position: 'absolute', left: `${pctMeus}%`, width: `${pctOutros}%`, height: '100%', background: hatch }} />
        )}
        {pctMeus > 0 && (
          <div style={{ position: 'absolute', left: 0, width: `${pctMeus}%`, height: '100%', background: cor }} />
        )}
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, color: cor, minWidth: 56, textAlign: 'right' }}>
        {fmtHoras(saldo.totalGeral)}/{TETO}h
      </span>
    </div>
  );
}

// ── Célula editável ────────────────────────────────────────────────────────────
//
// Estados:
//   idle    → exibe valor (ou "—") — clique inicia edição
//   editing → <input> com foco automático
//   saving  → exibe "…" com opacidade reduzida (SEM otimismo reverso)
//
// Confirmação: Enter · Tab · blur.   Cancelamento: Escape.
//
// Valor 0 ou vazio numa célula com alocação → DELETE /api/alocacoes/:id.
// Nova alocação (célula vazia) → POST com defaultMacroId/defaultMicroId (Geral).
// Atualização → POST upsert via composite key (preserva macro/micro anteriores).
//
// Bloqueio 409 → popover fixo ancorado à célula com distribuição do teto.

interface CelulaEditavelProps {
  celula:          CelulaData;        // { totalHoras, detalhes } | null
  projetoId:       string;
  defaultMacroId:  string | null;
  defaultMicroId:  string | null;     // ID da micro Geral (destino do clique rápido)
  colaboradorId:   string;
  colaboradorNome: string;
  totalGeral:      string;
  ano:             number;
  mes:             number;
  token:           string;
  onSaved:         () => void;
  onSavedSilent:   () => void;
  onOpenDrawer:    (info: DrawerInfo) => void;
  onBlocked?:      () => void;
  projCodigo:      string;
  projNome:        string;
  saldo:           Saldo;
  isHighlighted?:  boolean;
  readonly?:       boolean;
}

function CelulaEditavel(props: CelulaEditavelProps) {
  const { celula, projetoId, defaultMacroId, defaultMicroId,
          colaboradorId, colaboradorNome, totalGeral,
          ano, mes, token, onSaved, onSavedSilent, onOpenDrawer, onBlocked,
          projCodigo, projNome, saldo, isHighlighted = false,
          readonly = false } = props;

  // Localiza a alocação da micro Geral dentro dos detalhes da célula.
  // O clique rápido (inline edit) sempre escreve/deleta APENAS essa micro.
  // Outras micros (ex: Design, Conteúdo) permanecem intactas.
  const geralDetalhe  = celula?.detalhes.find(d => d.microEntregaId === defaultMicroId) ?? null;
  const geralHoras    = geralDetalhe ? parseFloat(geralDetalhe.horas) : 0;
  const geralRealizado: number | null = geralDetalhe?.horasRealizadas != null
    ? parseFloat(geralDetalhe.horasRealizadas)
    : null;

  const totalPlanNum  = celula ? parseFloat(celula.totalHoras) : 0;
  const totalRealNum: number | null = celula?.totalRealizado != null ? parseFloat(celula.totalRealizado) : null;
  const deltaCelula: number | null  = totalRealNum != null ? totalRealNum - totalPlanNum : null;

  // maxCelula = máximo que cabe na micro Geral deste projeto, dado o saldo total.
  // Usa geralHoras (não totalHoras) porque editamos só a Geral.
  const maxCelula = Math.max(0, TETO - parseFloat(totalGeral) + geralHoras);

  const [mode, setMode]         = useState<'idle' | 'editing' | 'saving'>('idle');
  const [editValue, setEditValue] = useState('');
  const [hovered, setHovered]   = useState(false);
  const [bloqueio, setBloqueio]   = useState<BloqueioInfo | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [modeReal, setModeReal]         = useState<'idle' | 'editing' | 'saving'>('idle');
  const [editValueReal, setEditValueReal] = useState('');

  const [modalSolicitar, setModalSolicitar] = useState(false);
  const [horasSolicitar, setHorasSolicitar] = useState('');
  const [solicitando, setSolicitando]       = useState(false);
  const [solicitarErro, setSolicitarErro]   = useState('');
  const [feedbackOk, setFeedbackOk]         = useState(false);

  const tdRef       = useRef<HTMLTableCellElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const activeRef   = useRef(false);
  const inputRealRef  = useRef<HTMLInputElement>(null);
  const activeRealRef = useRef(false);

  useEffect(() => {
    if (!bloqueio) return;
    const handler = (e: MouseEvent) => {
      if (tdRef.current && !tdRef.current.contains(e.target as Node)) setBloqueio(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bloqueio]);

  function startEdit() {
    setBloqueio(null);
    activeRef.current = true;
    // Edita as horas da Geral (não o total do projeto)
    setEditValue(geralHoras > 0 ? fmtHoras(geralHoras) : '');
    setMode('editing');
    setTimeout(() => { inputRef.current?.select(); }, 0);
  }

  function handleOpenDrawer(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenDrawer({
      colabId: colaboradorId, colabNome: colaboradorNome,
      projetoId, projCodigo, projNome,
      celula, saldo, ano, mes,
    });
  }

  function startEditReal() {
    activeRealRef.current = true;
    setEditValueReal(geralRealizado != null ? fmtHoras(geralRealizado) : '');
    setModeReal('editing');
    setTimeout(() => { inputRealRef.current?.select(); }, 0);
  }

  async function confirmReal() {
    if (!activeRealRef.current) return;
    activeRealRef.current = false;
    const val = editValueReal.trim();
    const h = parseFloat(val);
    const horasRealizadas = (!val || isNaN(h)) ? null : h;
    // Sem mudança
    if (horasRealizadas === null && geralRealizado === null) { setModeReal('idle'); return; }
    if (horasRealizadas !== null && geralRealizado !== null && Math.abs(horasRealizadas - geralRealizado) < 0.001) {
      setModeReal('idle'); return;
    }
    if (!geralDetalhe) { setModeReal('idle'); return; }
    setModeReal('saving');
    try {
      await fetch(`/api/alocacoes/${geralDetalhe.alocacaoId}/realizado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ horasRealizadas }),
      });
      onSavedSilent();
    } catch { /* silently fail */ }
    setModeReal('idle');
  }

  function cancelReal() {
    activeRealRef.current = false;
    setModeReal('idle');
  }

  async function confirm() {
    if (!activeRef.current) return;
    activeRef.current = false;

    const val   = editValue.trim();
    const horas = parseFloat(val);

    // ── Vazio ou zero: remove a Geral se existia, senão cancela ──────────
    if (!val || isNaN(horas) || horas <= 0) {
      if (geralDetalhe) {
        setMode('saving');
        try {
          await fetch(`/api/alocacoes/${geralDetalhe.alocacaoId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          onSaved();
        } catch { /* silently fail */ }
      }
      setMode('idle');
      return;
    }

    // ── Sem mudança na Geral: cancela sem rede ────────────────────────────
    if (geralHoras > 0 && Math.abs(horas - geralHoras) < 0.001) {
      setMode('idle');
      return;
    }

    // ── Salva via POST upsert — sempre na micro Geral ─────────────────────
    // Outras micros do projeto (Design, Conteúdo, etc.) NÃO são tocadas.
    const macroId = defaultMacroId;
    const microId = defaultMicroId;
    if (!macroId || !microId) { setMode('idle'); return; }

    setMode('saving');

    try {
      const res = await fetch('/api/alocacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ colaboradorId, projetoId, macroEntregaId: macroId, microEntregaId: microId, ano, mes, horasPlanejadas: horas }),
      });
      const data = await res.json();

      if (res.status === 201) {
        onSaved(); // refetch grid → atualiza saldo da linha
      } else if (res.status === 409 && data.bloqueado) {
        // Posiciona popover fixo (não clipado pelo overflow da tabela)
        const rect = tdRef.current?.getBoundingClientRect();
        if (rect) {
          setPopoverPos({
            top:  Math.min(rect.bottom + 6, window.innerHeight - 240),
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 276)),
          });
        }
        setBloqueio(data);
        // Concorrência: outro gestor pode ter ocupado as horas no meio —
        // atualiza a disponibilidade mostrada na faixa de candidatos (se houver).
        onBlocked?.();
      }
    } catch { /* silently fail */ }

    setMode('idle');
  }

  async function handleSolicitar() {
    if (!defaultMacroId || !defaultMicroId) return;
    const h = parseFloat(horasSolicitar);
    if (isNaN(h) || h <= 0) { setSolicitarErro('Informe uma quantidade válida de horas.'); return; }
    setSolicitando(true);
    setSolicitarErro('');
    try {
      const res = await fetch('/api/remanejamento/solicitacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          colaboradorId,
          projetoDestinoId: projetoId,
          macroEntregaDestinoId: defaultMacroId,
          microEntregaDestinoId: defaultMicroId,
          ano, mes,
          horasSolicitadas: h,
        }),
      });
      const d = await res.json();
      if (res.status === 201) {
        setModalSolicitar(false);
        setBloqueio(null);
        setFeedbackOk(true);
        setTimeout(() => setFeedbackOk(false), 2500);
      } else {
        setSolicitarErro(d.error ?? 'Erro ao criar solicitação.');
      }
    } catch {
      setSolicitarErro('Erro de rede.');
    }
    setSolicitando(false);
  }

  function cancel() {
    activeRef.current = false;
    setBloqueio(null);
    setMode('idle');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const tdStyle: React.CSSProperties = {
    width: COL_PROJ_W, minWidth: COL_PROJ_W,
    padding: 0,
    textAlign: 'center',
    borderRight: '1px solid var(--border)',
    verticalAlign: 'middle',
    position: 'relative',
    cursor: 'pointer',
    outline: bloqueio
      ? '2px solid #ef4444'
      : (mode === 'editing' && !readonly)
        ? '2px solid var(--brand-500)'
        : 'none',
    outlineOffset: '-2px',
    // Highlight passageiro: transição sempre presente para que o fade-out seja animado
    background: isHighlighted ? 'rgba(79,70,229,0.1)' : undefined,
    transition: 'background-color 0.6s ease, outline 0.1s',
  };

  return (
    <td
      ref={tdRef}
      style={tdStyle}
      onClick={() => { if (!readonly && mode === 'idle' && modeReal === 'idle') startEdit(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── idle: mostra totalHoras do projeto + ícone de drawer ── */}
      {mode === 'idle' && (
        <div style={{ padding: '6px 8px', position: 'relative' }}
          title={celula ? undefined : 'Clique para alocar'}>
          {celula ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.2 }}>
                {fmtHoras(celula.totalHoras)}h
              </div>
              {/* Zona do realizado — 3 estados independentes do planejado */}
              {modeReal === 'editing' ? (
                <div style={{ marginTop: 2 }} onClick={e => e.stopPropagation()}>
                  <input
                    ref={inputRealRef}
                    type="number" value={editValueReal} min={0} step={0.5}
                    autoFocus
                    onChange={e => setEditValueReal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  { e.preventDefault(); confirmReal(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelReal(); }
                    }}
                    onBlur={confirmReal}
                    style={{
                      width: '100%', background: 'transparent', border: 'none', outline: 'none',
                      textAlign: 'center', fontSize: 11, color: 'var(--text-2)', padding: 0,
                    }}
                  />
                </div>
              ) : modeReal === 'saving' ? (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, opacity: 0.35 }}>…</div>
              ) : (
                <div style={{ textAlign: 'center', marginTop: 2 }}>
                  <span
                    style={{
                      fontSize: 11, color: 'var(--text-3)',
                      display: 'inline-block', padding: '0 3px', borderRadius: 3,
                      cursor: (geralDetalhe && !readonly) ? 'text' : 'default',
                      borderBottom: (geralDetalhe && !readonly) ? '1px dashed var(--text-3)' : 'none',
                      transition: 'background 0.12s',
                    }}
                    onClick={e => {
                      e.stopPropagation();
                      if (geralDetalhe && mode === 'idle' && !readonly) startEditReal();
                    }}
                    onMouseEnter={e => { if (geralDetalhe && !readonly) (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                    title={(!geralDetalhe || readonly) ? undefined : undefined}
                  >
                    {celula.totalRealizado != null
                      ? `${fmtHoras(celula.totalRealizado)}h real.`
                      : '— real.'}
                  </span>
                </div>
              )}
              {deltaCelula != null && Math.abs(deltaCelula) >= 0.001 && (
                <div style={{ fontSize: 9, color: deltaCelula > 0 ? '#f59e0b' : 'var(--text-3)', marginTop: 1, textAlign: 'center', fontWeight: 500 }}>
                  {deltaCelula > 0 ? '+' : ''}{fmtHoras(deltaCelula)}h
                </div>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--text-3)', fontSize: 20, lineHeight: 1 }}>+</span>
          )}
          {feedbackOk && (
            <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, marginTop: 2, textAlign: 'center' }}>
              ✓ Solicitação criada
            </div>
          )}
          {/* Ícone de drawer — sempre montado (evita loop mount/unmount no hover),
              discreto por padrão, nítido no hover via opacity.
              O loop ocorria porque montar o botão sob o cursor disparava
              mouseleave no <td>, desmontava o botão, e repetia ad infinitum.
              Célula com alocação: 0.5 em repouso, 1 no hover (como já era).
              Célula vazia: 0 (invisível) em repouso, só aparece no hover — não
              polui o grid, mas o botão continua montado pra não reintroduzir o loop. */}
          {mode === 'idle' && (
            <button
              onClick={handleOpenDrawer}
              title={celula ? 'Ver composição macro/micro' : 'Alocar em macro/micro específica'}
              style={{
                position: 'absolute', top: 3, right: 3,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 4, cursor: 'pointer', padding: '2px 4px',
                display: 'flex', alignItems: 'center',
                color: 'var(--text-2)',
                opacity: celula ? (hovered ? 1 : 0.5) : (hovered ? 1 : 0),
                pointerEvents: celula || hovered ? 'auto' : 'none',
                transition: 'opacity 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-500)'; e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.opacity = celula ? (hovered ? '1' : '0.5') : (hovered ? '1' : '0'); }}
            >
              <List size={13} />
            </button>
          )}
        </div>
      )}

      {/* ── editing: input numérico ── */}
      {mode === 'editing' && (
        <div style={{ padding: '4px 8px' }}>
          <input
            ref={inputRef}
            type="number"
            value={editValue}
            min={0} max={220} step={0.5}
            autoFocus
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); confirm(); }
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            onBlur={confirm}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--text-1)',
              padding: 0,
            }}
          />
          <div style={{ fontSize: 10, marginTop: 2, fontWeight: 600,
            color: maxCelula <= 0 ? '#f87171' : maxCelula < 20 ? '#f59e0b' : 'var(--text-3)' }}>
            {maxCelula <= 0 ? 'sem espaço' : `máx ${fmtHoras(maxCelula)}h`}
          </div>
          {/* Aviso quando há outras micros além da Geral no projeto */}
          {celula && (celula.detalhes.length > 1 || !geralDetalhe) && (
            <div style={{ fontSize: 9, marginTop: 1, color: 'var(--text-3)' }}>
              editando micro Geral
            </div>
          )}
        </div>
      )}

      {/* ── saving: spinner visual, sem otimismo reverso ── */}
      {mode === 'saving' && (
        <div style={{ padding: '6px 12px', opacity: 0.35 }}>
          <div style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 600 }}>…</div>
        </div>
      )}

      {/* ── Popover de bloqueio (position:fixed — não clipado pelo overflow) ── */}
      {bloqueio && popoverPos && (
        <div
          style={{
            position: 'fixed',
            top: popoverPos.top,
            left: popoverPos.left,
            zIndex: 9999,
            width: 268,
            background: 'var(--surface-1)',
            border: '1.5px solid #ef4444',
            borderRadius: 12,
            boxShadow: '0 8px 28px rgba(0,0,0,0.25)',
            padding: '12px 14px',
            pointerEvents: 'auto',
          }}
          // Previne que o mousedown no popover o feche (o handler verifica tdRef)
          onMouseDown={e => e.stopPropagation()}
        >
          {/* Cabeçalho */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>
              Teto de 220h atingido
            </span>
            <button
              onClick={() => setBloqueio(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
            >
              ×
            </button>
          </div>

          {/* Resumo — usa totalGeral da linha (mesmo número da barra de saldo) */}
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, lineHeight: 1.5 }}>
            <strong>{colaboradorNome.split(' ')[0]}</strong> está em{' '}
            <strong style={{ color: '#f87171' }}>{fmtHoras(totalGeral)}/220h</strong> este mês.
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
            Máximo nesta célula:{' '}
            <strong style={{ color: maxCelula <= 0 ? '#f87171' : '#fbbf24' }}>
              {maxCelula <= 0 ? 'sem espaço' : `${fmtHoras(maxCelula)}h`}
            </strong>
          </div>

          {/* Distribuição */}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Distribuição atual
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {bloqueio.distribuicao.map((d, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-1)', padding: '3px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--brand-500)', fontWeight: 700 }}>{d.projetoCodigo}</span>
                  {' '}
                  <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{d.gestorNome}</span>
                </span>
                <strong style={{ flexShrink: 0, marginLeft: 8 }}>{d.horas}h</strong>
              </div>
            ))}
          </div>

          {/* Botão de solicitar remanejamento */}
          {!readonly && defaultMacroId && defaultMicroId && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <button
                onClick={e => {
                  e.stopPropagation();
                  const tentou = parseFloat(bloqueio.horasSolicitadas);
                  const incremento = Math.max(1, tentou - geralHoras);
                  setHorasSolicitar(String(incremento));
                  setSolicitarErro('');
                  setModalSolicitar(true);
                }}
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 8,
                  border: '1px solid var(--brand-500)',
                  background: 'hsl(221 83% 53% / 0.08)',
                  color: 'var(--brand-500)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'hsl(221 83% 53% / 0.15)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'hsl(221 83% 53% / 0.08)'; }}
              >
                Solicitar horas via remanejamento
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal de solicitação de remanejamento */}
      {modalSolicitar && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 10000 }}
            onClick={e => { e.stopPropagation(); if (!solicitando) { setModalSolicitar(false); setBloqueio(null); } }}
            onMouseDown={e => e.stopPropagation()}
          />
          <div
            style={{
              position: 'fixed', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10001, width: 400, maxWidth: 'calc(100vw - 32px)',
              background: 'var(--surface-1)', borderRadius: 14,
              boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
              padding: '22px 24px',
            }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
                Solicitar horas via remanejamento
              </h3>
              <button
                onClick={() => { setModalSolicitar(false); setSolicitarErro(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4, borderRadius: 6, fontSize: 18, lineHeight: 1 }}
              >×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  Colaborador
                </label>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  {colaboradorNome}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  Destino
                </label>
                <div style={{ fontSize: 13, color: 'var(--text-1)', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)', lineHeight: 1.55 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--brand-500)', fontSize: 12 }}>{projCodigo}</span>
                  {' — '}{projNome}
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {geralDetalhe ? `${geralDetalhe.macroNome} › ${geralDetalhe.microNome}` : 'Micro Geral'}
                    {' · '}{MESES[mes - 1]}/{ano}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                  Horas a solicitar
                </label>
                <input
                  type="number"
                  value={horasSolicitar}
                  min={0.5} step={0.5}
                  autoFocus
                  onChange={e => { setHorasSolicitar(e.target.value); setSolicitarErro(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSolicitar(); } if (e.key === 'Escape') { e.preventDefault(); setModalSolicitar(false); } }}
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, fontWeight: 600, outline: 'none' }}
                />
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, lineHeight: 1.55 }}>
                A solicitação vai para todos os gestores que têm <strong style={{ color: 'var(--text-2)' }}>{colaboradorNome.split(' ')[0]}</strong> em <strong style={{ color: 'var(--text-2)' }}>{MESES[mes - 1]}</strong>; eles poderão ceder horas.
              </div>

              {solicitarErro && (
                <div style={{ padding: '8px 10px', background: 'hsl(0 85% 60% / 0.08)', border: '1px solid hsl(0 85% 60% / 0.25)', borderRadius: 8, fontSize: 12, color: '#f87171' }}>
                  {solicitarErro}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  onClick={() => { setModalSolicitar(false); setSolicitarErro(''); }}
                  disabled={solicitando}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: solicitando ? 0.6 : 1 }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSolicitar}
                  disabled={solicitando}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--brand-500)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: solicitando ? 'not-allowed' : 'pointer', opacity: solicitando ? 0.6 : 1 }}
                >
                  {solicitando ? 'Solicitando…' : 'Solicitar'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </td>
  );
}

// ── Linha de micro editável dentro do drawer ──────────────────────────────────

function MicroLinha({
  macro, micro, horas, alocacaoId, horasRealizadas, totalGeralAtual, token,
  onSave, saving, onSaveRealizado, savingRealizado, bloqueio, onClearBloqueio, readonly,
}: {
  macro:            { id: string };
  micro:            { id: string; nome: string };
  horas:            number;
  alocacaoId:       string | null;
  horasRealizadas:  number | null;
  totalGeralAtual:  number;
  token:            string;
  onSave:           (macroId: string, microId: string, horas: number, alocId: string | null) => Promise<void>;
  saving:           boolean;
  onSaveRealizado:  (microId: string, alocId: string, horas: number | null) => Promise<void>;
  savingRealizado:  boolean;
  bloqueio:         BloqueioInfo | null;
  onClearBloqueio:  () => void;
  readonly:         boolean;
}) {
  const [val, setVal]         = useState(horas > 0 ? fmtHoras(horas) : '');
  const [valReal, setValReal] = useState(horasRealizadas != null ? fmtHoras(horasRealizadas) : '');
  const activeRef     = useRef(false);
  const activeRealRef = useRef(false);

  useEffect(() => {
    if (!activeRef.current) setVal(horas > 0 ? fmtHoras(horas) : '');
  }, [horas]);

  useEffect(() => {
    if (!activeRealRef.current) setValReal(horasRealizadas != null ? fmtHoras(horasRealizadas) : '');
  }, [horasRealizadas]);

  const maxMicro = Math.max(0, TETO - totalGeralAtual + horas);

  async function confirm() {
    if (!activeRef.current) return;
    activeRef.current = false;
    onClearBloqueio();
    const h = parseFloat(val);
    if (horas > 0 && !isNaN(h) && Math.abs(h - horas) < 0.001) return;
    await onSave(macro.id, micro.id, isNaN(h) || h <= 0 ? 0 : h, alocacaoId);
  }

  async function confirmReal() {
    if (!activeRealRef.current) return;
    activeRealRef.current = false;
    if (!alocacaoId) return;
    const h = parseFloat(valReal);
    const hrs = (!valReal.trim() || isNaN(h)) ? null : h;
    if (hrs === null && horasRealizadas === null) return;
    if (hrs !== null && horasRealizadas !== null && Math.abs(hrs - horasRealizadas) < 0.001) return;
    await onSaveRealizado(micro.id, alocacaoId, hrs);
  }

  const inputStyle: React.CSSProperties = {
    width: 60, textAlign: 'right', fontSize: 13, fontWeight: 600,
    background: 'var(--surface-1)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '3px 7px', color: 'var(--text-1)', outline: 'none',
    opacity: saving ? 0.45 : 1,
  };

  const realInputStyle: React.CSSProperties = {
    width: 52, textAlign: 'right', fontSize: 13, fontWeight: 600,
    background: 'var(--surface-3)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '3px 7px', color: 'var(--text-2)', outline: 'none',
    opacity: savingRealizado ? 0.45 : 1,
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 5 }}>
          {micro.nome}
          {micro.nome === 'Geral' && (
            <span style={{ fontSize: 9, color: 'var(--brand-500)', fontWeight: 600, textTransform: 'uppercase' }}>padrão</span>
          )}
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600,
            color: maxMicro <= 0 ? '#ef4444' : maxMicro < 20 ? '#f59e0b' : 'var(--text-3)' }}>
            {maxMicro <= 0 ? 'sem espaço' : `máx ${fmtHoras(maxMicro)}h`}
          </span>
          {/* Coluna Plan. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <span style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-3)' }}>Plan.</span>
            {saving ? (
              <span style={{ ...inputStyle, color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>...</span>
            ) : readonly ? (
              <span style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', cursor: 'default', border: 'none', background: 'transparent', opacity: 0.8 }}>
                {horas > 0 ? `${fmtHoras(horas)}` : '—'}
              </span>
            ) : (
              <input
                type="number" value={val} min={0} max={220} step={0.5} placeholder="-"
                style={inputStyle}
                onFocus={() => { activeRef.current = true; onClearBloqueio(); }}
                onChange={e => setVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  { e.preventDefault(); confirm(); }
                  if (e.key === 'Escape') { activeRef.current = false; setVal(horas > 0 ? fmtHoras(horas) : ''); onClearBloqueio(); }
                }}
                onBlur={confirm}
              />
            )}
          </div>
          {/* Coluna Real. — só quando há alocação nesta micro */}
          {alocacaoId && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
              <span style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-3)' }}>Real.</span>
              {savingRealizado ? (
                <span style={{ ...realInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>…</span>
              ) : readonly ? (
                <span style={{ ...realInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', cursor: 'default', border: 'none', background: 'transparent', opacity: 0.8 }}>
                  {horasRealizadas != null ? `${fmtHoras(horasRealizadas)}` : '—'}
                </span>
              ) : (
                <input
                  type="number" value={valReal} min={0} step={0.5} placeholder="—"
                  style={realInputStyle}
                  onFocus={() => { activeRealRef.current = true; }}
                  onChange={e => setValReal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.preventDefault(); confirmReal(); }
                    if (e.key === 'Escape') { activeRealRef.current = false; setValReal(horasRealizadas != null ? fmtHoras(horasRealizadas) : ''); }
                  }}
                  onBlur={confirmReal}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {bloqueio && (
        <div style={{ margin: '0 12px 8px', padding: '8px 10px', background: 'hsl(0 85% 60% / 0.08)', border: '1px solid hsl(0 85% 60% / 0.25)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>Teto de 220h atingido</span>
            <button onClick={onClearBloqueio} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 14, lineHeight: 1 }}>x</button>
          </div>
          <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-2)' }}>
            Disponível para esta micro: <strong style={{ color: '#f87171' }}>{bloqueio.horasDisponiveis}h</strong>
          </p>
          {bloqueio.distribuicao.slice(0, 3).map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
              <span><span style={{ fontFamily: 'monospace', color: 'var(--brand-500)' }}>{d.projetoCodigo}</span> {d.gestorNome}</span>
              <strong>{d.horas}h</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Painel lateral com edicao por macro/micro ─────────────────────────────────

function Drawer({ info, token, onClose, onSaved, onBlocked, readonly }: { info: DrawerInfo; token: string; onClose: () => void; onSaved: () => void; onBlocked?: () => void; readonly: boolean; }) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!drawerRef.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const { colabId, colabNome, projetoId, projCodigo, projNome, celula, saldo, ano, mes } = info;

  const [estrutura, setEstrutura]     = useState<MacroEstrutura[]>([]);
  const [loadingEstr, setLoadingEstr] = useState(true);

  type DetalheEntry = { alocacaoId: string; horas: number; horasRealizadas: number | null };
  const [detalheMap, setDetalheMap]   = useState<Record<string, DetalheEntry>>(() => {
    const m: Record<string, DetalheEntry> = {};
    if (celula) for (const d of celula.detalhes) m[d.microEntregaId] = {
      alocacaoId: d.alocacaoId,
      horas: parseFloat(d.horas),
      horasRealizadas: d.horasRealizadas != null ? parseFloat(d.horasRealizadas) : null,
    };
    return m;
  });

  const [totalGeralAtual, setTotalGeralAtual]   = useState(parseFloat(saldo.totalGeral));
  const [savingMicroId, setSavingMicroId]       = useState<string | null>(null);
  const [savingRealizadoId, setSavingRealizadoId] = useState<string | null>(null);
  const [bloqueioMap, setBloqueioMap]           = useState<Record<string, BloqueioInfo>>({});

  useEffect(() => {
    fetch(`/api/projetos/${projetoId}/macros`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: MacroEstrutura[]) => setEstrutura(data))
      .catch(() => {})
      .finally(() => setLoadingEstr(false));
  }, [projetoId, token]);

  const totalProjeto = Object.values(detalheMap).reduce((s, e) => s + e.horas, 0);

  async function refreshSaldo() {
    const r = await fetch(`/api/alocacoes?colaboradorId=${colabId}&ano=${ano}&mes=${mes}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return;
    const alocs: { horasPlanejadas: string }[] = await r.json();
    setTotalGeralAtual(alocs.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0));
  }

  async function handleSaveMicro(macroId: string, microId: string, horas: number, alocacaoId: string | null) {
    setSavingMicroId(microId);
    setBloqueioMap(m => { const n = { ...m }; delete n[microId]; return n; });
    try {
      if (horas <= 0) {
        if (alocacaoId) {
          await fetch(`/api/alocacoes/${alocacaoId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
          setDetalheMap(m => { const n = { ...m }; delete n[microId]; return n; });
          await refreshSaldo(); onSaved();
        }
      } else {
        const res = await fetch('/api/alocacoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ colaboradorId: colabId, projetoId, macroEntregaId: macroId, microEntregaId: microId, ano, mes, horasPlanejadas: horas }),
        });
        const data = await res.json();
        if (res.status === 201) {
          setDetalheMap(m => ({ ...m, [microId]: { alocacaoId: data.alocacao.id, horas, horasRealizadas: m[microId]?.horasRealizadas ?? null } }));
          await refreshSaldo(); onSaved();
        } else if (res.status === 409 && data.bloqueado) {
          setBloqueioMap(m => ({ ...m, [microId]: data }));
          // Concorrência: outro gestor pode ter ocupado as horas no meio —
          // atualiza a disponibilidade mostrada na faixa de candidatos.
          onBlocked?.();
        }
      }
    } catch { /* silently fail */ }
    setSavingMicroId(null);
  }

  async function handleSaveRealizado(microId: string, alocId: string, horas: number | null) {
    setSavingRealizadoId(microId);
    try {
      const res = await fetch(`/api/alocacoes/${alocId}/realizado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ horasRealizadas: horas }),
      });
      if (res.ok) {
        setDetalheMap(m => ({ ...m, [microId]: { ...m[microId], horasRealizadas: horas } }));
        onSaved();
      }
    } catch { /* silently fail */ }
    setSavingRealizadoId(null);
  }

  const corTotal  = totalGeralAtual >= 220 ? '#ef4444' : totalGeralAtual >= 176 ? '#f59e0b' : 'var(--text-1)';
  const dispAtual = Math.max(0, TETO - totalGeralAtual);

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 200 }} />
      <div ref={drawerRef} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 360, background: 'var(--surface-1)', borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 32px rgba(0,0,0,0.2)', zIndex: 201, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>{colabNome}</p>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 0' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--brand-500)' }}>{projCodigo}</span>{' '}{projNome}
              </p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4, borderRadius: 6, flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            ><X size={16} /></button>
          </div>
          <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8 }}>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Capacidade no mês · {MESES[mes - 1]} {ano}
            </p>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Total: <strong style={{ color: corTotal }}>{fmtHoras(totalGeralAtual)}/220h</strong></span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                Disponível: <strong style={{ color: dispAtual === 0 ? '#ef4444' : dispAtual < 20 ? '#f59e0b' : 'var(--text-1)' }}>{fmtHoras(dispAtual)}h</strong>
              </span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 0' }}>
          {loadingEstr ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 32, color: 'var(--text-3)', fontSize: 13 }}>Carregando estrutura…</div>
          ) : estrutura.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', marginTop: 40 }}>Nenhuma macro cadastrada neste projeto.</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Composição</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Total: {fmtHoras(totalProjeto)}h</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 14px' }}>
                {estrutura.map(macro => {
                  const macroTotal = macro.microEntregas.reduce((s, mi) => s + (detalheMap[mi.id]?.horas ?? 0), 0);
                  return (
                    <div key={macro.id} style={{ background: 'var(--surface-2)', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{macro.nome}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{macroTotal > 0 ? `${fmtHoras(macroTotal)}h` : '-'}</span>
                      </div>
                      {macro.microEntregas.map((micro, mi) => (
                        <div key={micro.id} style={{ borderTop: mi > 0 ? '1px solid var(--border)' : 'none' }}>
                          <MicroLinha
                            macro={macro} micro={micro}
                            horas={detalheMap[micro.id]?.horas ?? 0}
                            alocacaoId={detalheMap[micro.id]?.alocacaoId ?? null}
                            horasRealizadas={detalheMap[micro.id]?.horasRealizadas ?? null}
                            totalGeralAtual={totalGeralAtual}
                            token={token}
                            onSave={handleSaveMicro}
                            saving={savingMicroId === micro.id}
                            onSaveRealizado={handleSaveRealizado}
                            savingRealizado={savingRealizadoId === micro.id}
                            bloqueio={bloqueioMap[micro.id] ?? null}
                            onClearBloqueio={() => setBloqueioMap(m => { const n = { ...m }; delete n[micro.id]; return n; })}
                            readonly={readonly}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Busca de colaborador para adicionar ao grid ───────────────────────────────
// Usa GET /api/colaboradores?search=X&ativo=true (rota existente, sem alteração).
// Ao selecionar, busca saldo via GET /api/alocacoes?colaboradorId=X&ano=Y&mes=Z
// e computa totalGeral/totalOutros localmente — sem novo endpoint.

function BuscaColaborador({
  idsNoGrid, projetos, ano, mes, token, onAdd, onLocate,
}: {
  idsNoGrid: Set<string>;
  projetos: ProjetoCol[];
  ano: number; mes: number;
  token: string;
  onAdd: (extra: ExtraLinha) => void;
  onLocate: (colabId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<{ id: string; nome: string; profissao: { id: string; nome: string } | null }[]>([]);
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Busca com debounce de 300ms
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResultados([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/colaboradores?search=${encodeURIComponent(q)}&ativo=true`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.ok) {
          const data: { id: string; nome: string; profissao: { id: string; nome: string } | null; ativo: boolean }[] = await res.json();
          // Mostra TODOS os ativos — quem está no grid recebe badge, não é escondido
          setResultados(data.filter(c => c.ativo).slice(0, 8));
          setOpen(true);
        }
      } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query, token, idsNoGrid]);

  async function handleSelect(c: { id: string; nome: string; profissao: { id: string; nome: string } | null }) {
    setOpen(false);
    setQuery('');

    // Já está no grid → rola até a linha e destaca
    if (idsNoGrid.has(c.id)) {
      onLocate(c.id);
      return;
    }

    // Não está no grid → calcula saldo e adiciona como linha extra
    const res = await fetch(
      `/api/alocacoes?colaboradorId=${c.id}&ano=${ano}&mes=${mes}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const alocs: { projetoId: string; horasPlanejadas: string }[] = res.ok ? await res.json() : [];

    const meusProjIds = new Set(projetos.map(p => p.id));
    const totalGeral    = alocs.reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);
    const totalMeusProj = alocs.filter(a => meusProjIds.has(a.projetoId))
                               .reduce((s, a) => s + parseFloat(a.horasPlanejadas), 0);
    const totalOutros   = totalGeral - totalMeusProj;
    const disponivel    = Math.max(0, TETO - totalGeral);

    onAdd({
      colaborador: { id: c.id, nome: c.nome, profissao: c.profissao },
      saldo: {
        totalMeusProj: String(totalMeusProj),
        totalOutros:   String(totalOutros),
        totalGeral:    String(totalGeral),
        disponivel:    String(disponivel),
        custo:         null,
      },
    });
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '5px 10px 5px 28px', fontSize: 13,
    color: 'var(--text-1)', outline: 'none', width: 200,
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Input com ícone */}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }}
          placeholder="Adicionar colaborador…"
          style={inputStyle}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-3)' }}>…</span>
        )}
      </div>

      {/* Dropdown de resultados */}
      {open && resultados.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          width: 260, background: 'var(--surface-1)',
          border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 999, overflow: 'hidden',
        }}>
          {resultados.map((c, i) => {
            const jaNoGrid = idsNoGrid.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                style={{
                  width: '100%', textAlign: 'left', display: 'block',
                  padding: '8px 12px', background: 'none', border: 'none',
                  cursor: 'pointer', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{c.nome}</span>
                  {jaNoGrid && (
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                      background: 'var(--brand-500)18', color: 'var(--brand-500)',
                      textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
                    }}>
                      no grid
                    </span>
                  )}
                </div>
                {c.profissao && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.profissao.nome}</div>}
              </button>
            );
          })}
        </div>
      )}

      {/* Nenhum resultado */}
      {open && query.trim().length >= 2 && resultados.length === 0 && !loading && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          width: 240, background: 'var(--surface-1)',
          border: '1px solid var(--border)', borderRadius: 10,
          padding: '10px 12px', zIndex: 999, fontSize: 12, color: 'var(--text-3)',
        }}>
          Nenhum resultado ativo encontrado.
        </div>
      )}
    </div>
  );
}

// ── Seletor de mês ────────────────────────────────────────────────────────────

function SeletorMes({ mes, ano, onMes, onAno }: { mes: number; ano: number; onMes: (m: number) => void; onAno: (a: number) => void }) {
  const prev = () => { if (mes === 1) { onMes(12); onAno(ano - 1); } else onMes(mes - 1); };
  const next = () => { if (mes === 12) { onMes(1); onAno(ano + 1); } else onMes(mes + 1); };

  const btnStyle: React.CSSProperties = {
    width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: 'var(--text-3)', border: '1px solid var(--border)', background: 'transparent',
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button style={btnStyle} onClick={prev}><ChevronLeft size={14} /></button>
      <div className="flex items-center gap-1.5">
        <select value={mes} onChange={e => onMes(parseInt(e.target.value))}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', fontSize: 13, color: 'var(--text-1)', outline: 'none' }}>
          {MESES.map((nm, i) => <option key={i + 1} value={i + 1}>{nm}</option>)}
        </select>
        <input type="number" value={ano} min={2020} max={2100} onChange={e => onAno(parseInt(e.target.value))}
          style={{ width: 72, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', fontSize: 13, color: 'var(--text-1)', outline: 'none', textAlign: 'center' }} />
      </div>
      <button style={btnStyle} onClick={next}><ChevronRight size={14} /></button>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function GridAlocacao() {
  const { token, user } = useAuth();
  const { gestorIdFiltro } = useGestorFiltro();
  const isAdmin = user?.role === 'admin';

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [data, setData]       = useState<GridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');

  // Colaboradores adicionados manualmente (sem alocação nos meus projetos ainda)
  const [extrasColabs, setExtrasColabs] = useState<ExtraLinha[]>([]);

  // Filtro de profissão — esconde linhas no cliente, NÃO refaz a query do grid
  // (custoPorProjeto vem pronto do backend e não é afetado por este filtro).
  const [profissoesFiltro, setProfissoesFiltro] = useState<{ id: string; nome: string }[]>([]);
  const [filtroProfissaoId, setFiltroProfissaoId] = useState('');

  // Faixa de candidatos — só existe (no DOM) quando há filtroProfissaoId.
  // Puramente exibição neste passo (4c-frontend); alocar é o passo seguinte.
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [candidatosLoading, setCandidatosLoading] = useState(false);

  // Painel lateral de detalhamento
  const [drawer, setDrawer] = useState<DrawerInfo | null>(null);

  // Copiar planejado → realizado
  const [confirmCopiar, setConfirmCopiar]   = useState(false);
  const [copiando, setCopiando]             = useState(false);
  const [feedbackCopiar, setFeedbackCopiar] = useState('');

  // Fechar / reabrir mês (admin)
  const [confirmFechaAbre, setConfirmFechaAbre] = useState<'fechar' | 'reabrir' | null>(null);
  const [fechandoMes, setFechandoMes]            = useState(false);

  // Highlight passageiro ao localizar colaborador via busca
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mapa colabId → <tr> element para scroll programático
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  function handleLocate(colabId: string) {
    const el = rowRefs.current.get(colabId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Highlight: liga, e desliga após 2s (a transição CSS cobre o fade-out)
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedId(colabId);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), 2000);
  }

  // Limpa os extras ao navegar para outro mês/filtro (são contextuais ao mês e ao gestor)
  useEffect(() => { setExtrasColabs([]); }, [ano, mes, gestorIdFiltro]);

  // Remove extras que agora aparecem naturalmente no grid (ganharam alocação)
  useEffect(() => {
    if (!data) return;
    const idsGrid = new Set(data.linhas.map(l => l.colaborador.id));
    setExtrasColabs(prev => prev.filter(e => !idsGrid.has(e.colaborador.id)));
  }, [data]);

  // Mescla linhas do grid + extras, ordenado por nome
  const todasLinhas: Linha[] = useMemo(() => {
    if (!data) return [];
    const idsGrid = new Set(data.linhas.map(l => l.colaborador.id));
    const extras  = extrasColabs
      .filter(e => !idsGrid.has(e.colaborador.id))
      .map(e => ({
        colaborador: e.colaborador,
        saldo:       e.saldo,
        celulas:     Object.fromEntries(data.projetos.map(p => [p.id, null])) as Record<string, CelulaData>,
      }));
    return [...data.linhas, ...extras]
      .sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome, 'pt-BR'));
  }, [data, extrasColabs]);

  // Linhas REALMENTE renderizadas — filtro de profissão por cima de todasLinhas.
  // Puramente visual: saldo/células/totais por projeto seguem vindo intactos
  // de todasLinhas/data, nada disso é recalculado aqui.
  const linhasExibidas: Linha[] = useMemo(() => {
    if (!filtroProfissaoId) return todasLinhas;
    return todasLinhas.filter(l => l.colaborador.profissao?.id === filtroProfissaoId);
  }, [todasLinhas, filtroProfissaoId]);

  const fetchProfissoesFiltro = useCallback(async () => {
    const res = await fetch('/api/profissoes?ativo=true', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setProfissoesFiltro(await res.json());
  }, [token]);

  useEffect(() => { fetchProfissoesFiltro(); }, [fetchProfissoesFiltro]);

  // Busca os candidatos quando a profissão filtrada (ou o mês) muda.
  // Sem profissão selecionada → limpa (a faixa nem existe no DOM nesse caso).
  // Extraído em função (não só efeito) pra poder ser re-chamado manualmente
  // depois que o drawer aloca um candidato (ele precisa sair da lista).
  const fetchCandidatos = useCallback(async (silent = false) => {
    if (!filtroProfissaoId) { setCandidatos([]); return; }
    if (!silent) setCandidatosLoading(true);
    try {
      const res = await fetch(
        `/api/alocacoes/candidatos?profissaoId=${filtroProfissaoId}&ano=${ano}&mes=${mes}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) setCandidatos(await res.json());
    } finally {
      if (!silent) setCandidatosLoading(false);
    }
  }, [filtroProfissaoId, ano, mes, token]);

  useEffect(() => { fetchCandidatos(); }, [fetchCandidatos]);

  // IDs já no grid (para filtrar os resultados da busca)
  const idsNoGrid = useMemo(() => new Set(todasLinhas.map(l => l.colaborador.id)), [todasLinhas]);

  // Conta alocações visíveis sem realizado (estimativa para o dialog de cópia)
  const nullRealizadoCount = useMemo(() => {
    if (!data) return 0;
    return data.linhas.reduce((total, linha) =>
      total + Object.values(linha.celulas).reduce((sum, c) => {
        if (!c) return sum;
        return sum + c.detalhes.filter(d => d.horasRealizadas === null).length;
      }, 0), 0);
  }, [data]);

  const fetchGrid = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErro('');
    try {
      const qs = gestorIdFiltro
        ? `/api/alocacoes/grid?ano=${ano}&mes=${mes}&gestorId=${gestorIdFiltro}`
        : `/api/alocacoes/grid?ano=${ano}&mes=${mes}`;
      const res = await fetch(qs, {
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
  }, [token, ano, mes, gestorIdFiltro]);

  useEffect(() => { fetchGrid(); }, [fetchGrid]);

  // Limpa feedback de cópia após 4s
  useEffect(() => {
    if (!feedbackCopiar) return;
    const t = setTimeout(() => setFeedbackCopiar(''), 4000);
    return () => clearTimeout(t);
  }, [feedbackCopiar]);

  async function handleCopiarRealizado() {
    setCopiando(true);
    try {
      const res = await fetch('/api/alocacoes/copiar-realizado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ano, mes }),
      });
      if (res.ok) {
        const d = await res.json();
        const n = d.atualizadas as number;
        setFeedbackCopiar(`${n} célula${n !== 1 ? 's' : ''} preenchida${n !== 1 ? 's' : ''}`);
        fetchGrid();
      }
    } catch {}
    setCopiando(false);
    setConfirmCopiar(false);
  }

  const mesFechado = data?.fechado ?? false;

  async function handleFecharMes() {
    setFechandoMes(true);
    try {
      const res = await fetch('/api/fechamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ano, mes }),
      });
      if (res.ok || res.status === 409) fetchGrid();
    } catch {}
    setFechandoMes(false);
    setConfirmFechaAbre(null);
  }

  async function handleReabrirMes() {
    setFechandoMes(true);
    try {
      const res = await fetch(`/api/fechamentos/${ano}/${mes}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok || res.status === 404) fetchGrid();
    } catch {}
    setFechandoMes(false);
    setConfirmFechaAbre(null);
  }

  // ── Estilos sticky ────────────────────────────────────────────────────────

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
    padding: '8px 12px', fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--text-3)',
    background: 'var(--surface-2)',
    borderBottom: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    whiteSpace: 'nowrap', verticalAlign: 'bottom',
  };

  const mesLabel = `${MESES[mes - 1]} ${ano}`;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
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
        <SeletorGestor />
        {isAdmin && data && (
          <button
            onClick={() => setConfirmFechaAbre(mesFechado ? 'reabrir' : 'fechar')}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              padding: '5px 10px', borderRadius: 8, border: `1px solid ${mesFechado ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
              background: mesFechado ? 'rgba(239,68,68,0.06)' : 'var(--surface-2)',
              color: mesFechado ? '#f87171' : 'var(--text-2)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = mesFechado ? 'rgba(239,68,68,0.12)' : 'var(--surface-3)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = mesFechado ? 'rgba(239,68,68,0.06)' : 'var(--surface-2)'; }}
          >
            {mesFechado ? '🔒 Reabrir mês' : 'Fechar mês'}
          </button>
        )}
        {data && (
          <>
            <BuscaColaborador
              idsNoGrid={idsNoGrid}
              projetos={data.projetos}
              ano={ano} mes={mes}
              token={token!}
              onAdd={(extra) =>
                setExtrasColabs(prev =>
                  prev.some(e => e.colaborador.id === extra.colaborador.id) ? prev : [...prev, extra]
                )
              }
              onLocate={handleLocate}
            />
            <div className="flex items-center gap-1.5" style={{ minWidth: 200, flexShrink: 0 }}>
              <div style={{ minWidth: 170 }}>
                <Combobox
                  options={profissoesFiltro.map(p => ({ id: p.id, nome: p.nome }))}
                  value={filtroProfissaoId}
                  onChange={setFiltroProfissaoId}
                  placeholder="Filtrar por profissão"
                />
              </div>
              {filtroProfissaoId && (
                <button
                  onClick={() => setFiltroProfissaoId('')}
                  title="Limpar filtro de profissão"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                    border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text-1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-2)'; }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {!mesFechado && user?.role !== 'coordenacao' && <button
              onClick={() => setConfirmCopiar(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--surface-2)', color: 'var(--text-2)',
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text-1)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-2)'; }}
            >
              Copiar plan. → real.
            </button>}
            {feedbackCopiar && (
              <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, flexShrink: 0 }}>
                ✓ {feedbackCopiar}
              </span>
            )}
            <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
              {linhasExibidas.length} colaborador{linhasExibidas.length !== 1 ? 'es' : ''}
              {filtroProfissaoId ? ` de ${todasLinhas.length}` : ''} ·{' '}
              {data.projetos.length} projeto{data.projetos.length !== 1 ? 's' : ''}
              {' '}· clique em célula para editar
            </span>
          </>
        )}
      </div>

      {/* ── Banner de mês fechado ──────────────────────────────────────── */}
      {mesFechado && (
        <div style={{ padding: '8px 20px', background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid rgba(239,68,68,0.18)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: '#f87171', fontWeight: 500 }}>
            🔒 {MESES[mes - 1]} {ano} está fechado — somente leitura.
          </span>
        </div>
      )}

      {/* ── Conteúdo ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-40 gap-2" style={{ color: 'var(--text-3)' }}>
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
              <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Carregando {mesLabel}…
          </div>
        )}
        {!loading && erro && <div className="p-6 text-sm" style={{ color: '#f87171' }}>{erro}</div>}
        {!loading && !erro && data && data.projetos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-60 gap-2" style={{ color: 'var(--text-3)' }}>
            <LayoutGrid size={40} strokeWidth={1} />
            <p className="text-sm">Nenhum projeto ativo.</p>
          </div>
        )}
        {!loading && !erro && data && data.projetos.length > 0 && todasLinhas.length === 0 && (
          <div className="flex flex-col items-center justify-center h-60 gap-2" style={{ color: 'var(--text-3)' }}>
            <LayoutGrid size={40} strokeWidth={1} />
            <p className="text-sm font-medium">Nenhuma alocação em {mesLabel}.</p>
            <p className="text-xs">Use <strong>Adicionar colaborador…</strong> acima para alocar neste mês.</p>
          </div>
        )}
        {!loading && !erro && data && todasLinhas.length > 0 && linhasExibidas.length === 0 && (
          <div className="flex flex-col items-center justify-center h-60 gap-2" style={{ color: 'var(--text-3)' }}>
            <LayoutGrid size={40} strokeWidth={1} />
            <p className="text-sm font-medium">Nenhum colaborador com essa profissão em {mesLabel}.</p>
            <p className="text-xs">Limpe o filtro de profissão pra ver todas as linhas.</p>
          </div>
        )}

        {!loading && !erro && data && linhasExibidas.length > 0 && (
          <table style={{
            borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed',
            minWidth: COL_COLAB_W + COL_SALDO_W + data.projetos.length * COL_PROJ_W,
          }}>
            <colgroup>
              <col style={{ width: COL_COLAB_W }} />
              <col style={{ width: COL_SALDO_W }} />
              {data.projetos.map(p => <col key={p.id} style={{ width: COL_PROJ_W }} />)}
            </colgroup>

            <thead>
              <tr>
                {/* Colaborador (sticky) */}
                <th style={{ ...thBase, ...stickyColabStyle, background: 'var(--surface-2)', zIndex: 20 }}>
                  Colaborador
                </th>

                {/* Saldo (sticky) */}
                <th style={{ ...thBase, ...stickySaldoStyle, background: 'var(--surface-2)', zIndex: 20, left: COL_COLAB_W, borderRight: '2px solid var(--border)' }}>
                  Saldo {TETO}h
                  <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-3)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: '#22c55e', borderRadius: 2 }} />
                      você
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: 'repeating-linear-gradient(45deg,#22c55e,#22c55e 2px,transparent 2px,transparent 5px)', borderRadius: 2 }} />
                      outros gestores
                    </span>
                  </div>
                </th>

                {/* Projetos */}
                {data.projetos.map(p => {
                  const anoMes = ano * 12 + mes;
                  let foraVigencia = false;
                  let tooltipVig = '';
                  if (p.vigenciaInicio || p.vigenciaFim) {
                    const fmtVig = (iso: string) => {
                      const d = new Date(iso);
                      return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
                    };
                    if (p.vigenciaInicio) {
                      const d = new Date(p.vigenciaInicio);
                      if (anoMes < d.getUTCFullYear() * 12 + d.getUTCMonth() + 1) foraVigencia = true;
                    }
                    if (p.vigenciaFim) {
                      const d = new Date(p.vigenciaFim);
                      if (anoMes > d.getUTCFullYear() * 12 + d.getUTCMonth() + 1) foraVigencia = true;
                    }
                    if (foraVigencia) {
                      const inicio = p.vigenciaInicio ? fmtVig(p.vigenciaInicio) : '?';
                      const fim    = p.vigenciaFim    ? fmtVig(p.vigenciaFim)    : '?';
                      tooltipVig = `Este mês está fora da vigência do projeto (${inicio} – ${fim})`;
                    }
                  }
                  return (
                    <th key={p.id} style={{ ...thBase, textAlign: 'center', width: COL_PROJ_W }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }} title={p.nome}>
                        {p.codigo}
                        {foraVigencia && (
                          <span title={tooltipVig} style={{ lineHeight: 0, cursor: 'default' }}>
                            <AlertTriangle size={10} style={{ color: 'hsl(38 92% 50%)', flexShrink: 0 }} />
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: COL_PROJ_W - 16 }} title={p.nome}>{p.nome}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {linhasExibidas.map((linha, idx) => {
                const totalG      = parseFloat(linha.saldo.totalGeral);
                const pctTotal    = (totalG / TETO) * 100;
                const cor         = corSaldo(pctTotal);
                const isHighlight = highlightedId === linha.colaborador.id;
                // Quando destacado, sobrepõe a cor zebrada com highlight; transição no td
                const rowBg = isHighlight
                  ? 'rgba(79,70,229,0.08)'
                  : idx % 2 === 0 ? 'var(--surface-1)' : 'var(--surface-2)';

                return (
                  <tr
                    key={linha.colaborador.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(linha.colaborador.id, el);
                      else rowRefs.current.delete(linha.colaborador.id);
                    }}
                  >
                    {/* Colaborador (sticky) */}
                    <td style={{ ...stickyColabStyle, background: rowBg, verticalAlign: 'middle', transition: 'background-color 0.6s ease' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={linha.colaborador.nome}>
                        {linha.colaborador.nome}
                      </div>
                      {linha.colaborador.profissao && (
                        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {linha.colaborador.profissao.nome}
                        </div>
                      )}
                    </td>

                    {/* Saldo (sticky) */}
                    <td style={{ ...stickySaldoStyle, background: rowBg, left: COL_COLAB_W, borderRight: '2px solid var(--border)', verticalAlign: 'middle', transition: 'background-color 0.6s ease' }}>
                      <BarraSaldo saldo={linha.saldo} />
                      {(
                        <div style={{ fontSize: 9, marginTop: 3, color: cor, fontWeight: 600 }}>
                          {pctTotal >= 100 ? 'Capacidade esgotada' : `${fmtHoras(TETO - totalG)}h disponíveis`}
                        </div>
                      )}
                      {linha.saldo.custo != null && (
                        <div style={{ fontSize: 9, marginTop: 1, color: 'var(--text-3)', fontWeight: 400 }}>
                          {fmtMoeda(linha.saldo.custo)} <span style={{ opacity: 0.7 }}>({isAdmin ? 'total' : 'seus projetos'})</span>
                        </div>
                      )}
                    </td>

                    {/* Células editáveis */}
                    {data.projetos.map(p => (
                      <CelulaEditavel
                        key={p.id}
                        celula={linha.celulas[p.id] ?? null}
                        projetoId={p.id}
                        defaultMacroId={p.defaultMacroId}
                        defaultMicroId={p.defaultMicroId}
                        colaboradorId={linha.colaborador.id}
                        colaboradorNome={linha.colaborador.nome}
                        totalGeral={linha.saldo.totalGeral}
                        ano={ano}
                        mes={mes}
                        token={token!}
                        onSaved={() => { fetchGrid(); fetchCandidatos(true); }}
                        onSavedSilent={() => { fetchGrid(true); fetchCandidatos(true); }}
                        onOpenDrawer={setDrawer}
                        onBlocked={() => fetchCandidatos(true)}
                        projCodigo={p.codigo}
                        projNome={p.nome}
                        saldo={linha.saldo}
                        isHighlighted={isHighlight}
                        readonly={mesFechado || user?.role === 'coordenacao'}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr>
                {/* Colaborador (sticky esquerda + base) */}
                <td style={{
                  ...stickyColabStyle, position: 'sticky', bottom: 0, zIndex: 15,
                  background: 'var(--surface-2)', borderTop: '2px solid var(--border)',
                  fontSize: 12, fontWeight: 700, color: 'var(--text-1)',
                }}>
                  Total do projeto
                </td>

                {/* Saldo (sticky esquerda + base) — sem conteúdo, mantém alinhamento */}
                <td style={{
                  ...stickySaldoStyle, position: 'sticky', bottom: 0, zIndex: 15,
                  left: COL_COLAB_W, background: 'var(--surface-2)',
                  borderTop: '2px solid var(--border)', borderRight: '2px solid var(--border)',
                }} />

                {/* Custo total por projeto (sticky base) */}
                {data.projetos.map(p => {
                  const custo = data.custoPorProjeto[p.id] ?? null;
                  return (
                    <td key={p.id} style={{
                      position: 'sticky', bottom: 0, zIndex: 12,
                      background: 'var(--surface-2)', textAlign: 'center',
                      padding: '8px 6px', borderTop: '2px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      fontSize: 12, fontWeight: 700, color: 'var(--text-1)',
                    }}>
                      {custo != null ? fmtMoeda(custo) : '—'}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        )}

        {/* ── Faixa de candidatos — só existe quando há profissão filtrada ──
            Seção separada, FORA do <tbody> dos alocados; não afeta saldo,
            células nem o rodapé de custo de cima. Puramente exibição neste
            passo (4c-frontend) — alocar a partir daqui é o passo seguinte. ── */}
        {filtroProfissaoId && data && (
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: '2px dashed var(--border)' }}>
            <h3 style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: 'var(--text-3)', margin: '0 0 8px', paddingLeft: 4,
            }}>
              Candidatos disponíveis — {profissoesFiltro.find(p => p.id === filtroProfissaoId)?.nome ?? ''} ({candidatos.length})
            </h3>

            {candidatosLoading ? (
              <div className="flex items-center gap-2" style={{ color: 'var(--text-3)', fontSize: 12, padding: '6px 4px' }}>
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Carregando candidatos…
              </div>
            ) : candidatos.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '6px 4px' }}>
                Nenhum candidato disponível nesta profissão neste mês.
              </div>
            ) : (
              <table style={{
                borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed',
                minWidth: COL_COLAB_W + COL_SALDO_W + data.projetos.length * COL_PROJ_W,
              }}>
                <colgroup>
                  <col style={{ width: COL_COLAB_W }} />
                  <col style={{ width: COL_SALDO_W }} />
                  {data.projetos.map(p => <col key={p.id} style={{ width: COL_PROJ_W }} />)}
                </colgroup>
                <tbody>
                  {candidatos.map((cand, idx) => {
                    // Saldo sintético: do ponto de vista do gestor logado, o
                    // candidato nunca tem horas "minhas" (por definição — é
                    // candidato justamente por eu não tê-lo alocado ainda).
                    const saldoSintetico: Saldo = {
                      totalMeusProj: '0',
                      totalOutros:   cand.totalAlocado,
                      totalGeral:    cand.totalAlocado,
                      disponivel:    cand.disponivel,
                      custo:         null,
                    };
                    const rowBg = idx % 2 === 0 ? 'var(--surface-2)' : 'var(--surface-1)';
                    return (
                      <tr key={cand.id}>
                        {/* Colaborador (sticky, "desidratado") */}
                        <td style={{
                          ...stickyColabStyle, background: rowBg, opacity: 0.85,
                          borderBottom: '1px dashed var(--border)', verticalAlign: 'middle',
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cand.nome}>
                            {cand.nome}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cand.email}
                          </div>
                        </td>

                        {/* Saldo (sticky, mesma BarraSaldo do grid — read-only) */}
                        <td style={{
                          ...stickySaldoStyle, background: rowBg, left: COL_COLAB_W, opacity: 0.85,
                          borderBottom: '1px dashed var(--border)', borderRight: '2px dashed var(--border)', verticalAlign: 'middle',
                        }}>
                          <BarraSaldo saldo={saldoSintetico} />
                          <div style={{ fontSize: 9, marginTop: 3, color: 'var(--text-3)', fontWeight: 600 }}>
                            candidato · ainda não alocado
                          </div>
                        </td>

                        {/* Células por projeto — MESMA CelulaEditavel dos alocados:
                            clique vira input → Enter/blur grava na Geral (POST
                            /alocacoes, mesmo lock/teto); ícone de drawer continua
                            pro macro/micro detalhado. celula:null (nunca alocado). */}
                        {data.projetos.map(p => (
                          <CelulaEditavel
                            key={p.id}
                            celula={null}
                            projetoId={p.id}
                            defaultMacroId={p.defaultMacroId}
                            defaultMicroId={p.defaultMicroId}
                            colaboradorId={cand.id}
                            colaboradorNome={cand.nome}
                            totalGeral={saldoSintetico.totalGeral}
                            ano={ano}
                            mes={mes}
                            token={token!}
                            onSaved={() => { fetchGrid(true); fetchCandidatos(true); }}
                            onSavedSilent={() => fetchCandidatos(true)}
                            onOpenDrawer={setDrawer}
                            onBlocked={() => fetchCandidatos(true)}
                            projCodigo={p.codigo}
                            projNome={p.nome}
                            saldo={saldoSintetico}
                            readonly={mesFechado || user?.role === 'coordenacao'}
                          />
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Modal de confirmação: copiar planejado → realizado */}
      {confirmCopiar && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { if (!copiando) setConfirmCopiar(false); }}
        >
          <div
            style={{ background: 'var(--surface-1)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: '20px 24px', width: 340, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 10px' }}>
              Copiar planejado → realizado
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 16px', lineHeight: 1.55 }}>
              {nullRealizadoCount > 0
                ? `Preenche o realizado de ${nullRealizadoCount} célula${nullRealizadoCount !== 1 ? 's' : ''} ainda sem valor com o planejado do mês.`
                : 'Todas as células visíveis já têm realizado preenchido.'}
              {' '}Registros que já têm realizado não são alterados.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmCopiar(false)}
                disabled={copiando}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleCopiarRealizado}
                disabled={copiando || nullRealizadoCount === 0}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: 'var(--brand-500)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: copiando || nullRealizadoCount === 0 ? 'not-allowed' : 'pointer', opacity: copiando || nullRealizadoCount === 0 ? 0.6 : 1 }}
              >
                {copiando ? 'Copiando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação: fechar mês */}
      {confirmFechaAbre === 'fechar' && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { if (!fechandoMes) setConfirmFechaAbre(null); }}
        >
          <div
            style={{ background: 'var(--surface-1)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: '20px 24px', width: 340, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 10px' }}>
              Fechar {MESES[mes - 1]} {ano}?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 16px', lineHeight: 1.55 }}>
              As alocações deste mês ficam somente leitura para todos. Nenhum dado é apagado — o mês pode ser reaberto a qualquer momento.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmFechaAbre(null)}
                disabled={fechandoMes}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleFecharMes}
                disabled={fechandoMes}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 600, cursor: fechandoMes ? 'not-allowed' : 'pointer', opacity: fechandoMes ? 0.6 : 1 }}
              >
                {fechandoMes ? 'Fechando…' : 'Fechar mês'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação: reabrir mês */}
      {confirmFechaAbre === 'reabrir' && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { if (!fechandoMes) setConfirmFechaAbre(null); }}
        >
          <div
            style={{ background: 'var(--surface-1)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: '20px 24px', width: 340, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 10px' }}>
              Reabrir {MESES[mes - 1]} {ano}?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 16px', lineHeight: 1.55 }}>
              As alocações deste mês voltam a ser editáveis.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmFechaAbre(null)}
                disabled={fechandoMes}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleReabrirMes}
                disabled={fechandoMes}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: 'var(--brand-500)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: fechandoMes ? 'not-allowed' : 'pointer', opacity: fechandoMes ? 0.6 : 1 }}
              >
                {fechandoMes ? 'Reabrindo…' : 'Reabrir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer lateral de detalhamento */}
      {drawer && <Drawer info={drawer} token={token!} onClose={() => setDrawer(null)} onSaved={() => { fetchGrid(true); fetchCandidatos(true); }} onBlocked={() => fetchCandidatos(true)} readonly={mesFechado || user?.role === 'coordenacao'} />}
    </div>
  );
}
