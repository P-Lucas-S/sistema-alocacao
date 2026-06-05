import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { LayoutGrid, ChevronLeft, ChevronRight, Search, List, X } from 'lucide-react';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface ProjetoCol {
  id: string;
  codigo: string;
  nome: string;
  gestorId: string;
  defaultMacroId: string | null;
  defaultMicroId: string | null;
}

// Uma alocação individual dentro de uma célula (uma macro/micro específica)
interface CelulaDetalhe {
  alocacaoId:    string;
  macroNome:     string;
  microNome:     string;
  macroEntregaId: string;
  microEntregaId: string;
  horas:         string;
}

// Dados de uma célula: total do projeto + composição por macro/micro
// null quando o colaborador não tem nenhuma alocação naquele projeto
type CelulaData = {
  totalHoras: string;
  detalhes:   CelulaDetalhe[];
} | null;

interface Saldo {
  totalMeusProj: string;
  totalOutros:   string;
  totalGeral:    string;
  disponivel:    string;
}

interface Linha {
  colaborador: { id: string; nome: string; funcao: string | null };
  saldo: Saldo;
  celulas: Record<string, CelulaData>;
}

interface GridData {
  projetos: ProjetoCol[];
  linhas:   Linha[];
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
  colaborador: { id: string; nome: string; funcao: string | null };
  saldo: Saldo;
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
  onOpenDrawer:    (info: DrawerInfo) => void;
  projCodigo:      string;
  projNome:        string;
  saldo:           Saldo;
  isHighlighted?:  boolean;
}

function CelulaEditavel(props: CelulaEditavelProps) {
  const { celula, projetoId, defaultMacroId, defaultMicroId,
          colaboradorId, colaboradorNome, totalGeral,
          ano, mes, token, onSaved, onOpenDrawer,
          projCodigo, projNome, saldo, isHighlighted = false } = props;

  // Localiza a alocação da micro Geral dentro dos detalhes da célula.
  // O clique rápido (inline edit) sempre escreve/deleta APENAS essa micro.
  // Outras micros (ex: Design, Conteúdo) permanecem intactas.
  const geralDetalhe  = celula?.detalhes.find(d => d.microEntregaId === defaultMicroId) ?? null;
  const geralHoras    = geralDetalhe ? parseFloat(geralDetalhe.horas) : 0;

  // maxCelula = máximo que cabe na micro Geral deste projeto, dado o saldo total.
  // Usa geralHoras (não totalHoras) porque editamos só a Geral.
  const maxCelula = Math.max(0, TETO - parseFloat(totalGeral) + geralHoras);

  const [mode, setMode]         = useState<'idle' | 'editing' | 'saving'>('idle');
  const [editValue, setEditValue] = useState('');
  const [hovered, setHovered]   = useState(false);
  const [bloqueio, setBloqueio]   = useState<BloqueioInfo | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const tdRef    = useRef<HTMLTableCellElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(false);

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
      }
    } catch { /* silently fail */ }

    setMode('idle');
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
      : mode === 'editing'
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
      onClick={() => { if (mode === 'idle') startEdit(); }}
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
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>— real.</div>
            </>
          ) : (
            <span style={{ color: 'var(--text-3)', fontSize: 20, lineHeight: 1 }}>+</span>
          )}
          {/* Ícone de drawer — sempre montado (evita loop mount/unmount no hover),
              discreto por padrão, nítido no hover via opacity.
              O loop ocorria porque montar o botão sob o cursor disparava
              mouseleave no <td>, desmontava o botão, e repetia ad infinitum. */}
          {celula && mode === 'idle' && (
            <button
              onClick={handleOpenDrawer}
              title="Ver composição macro/micro"
              style={{
                position: 'absolute', top: 3, right: 3,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 4, cursor: 'pointer', padding: '2px 4px',
                display: 'flex', alignItems: 'center',
                color: 'var(--text-2)',
                // 0.5 em repouso: discreto mas claramente perceptível
                // 1 no hover: nítido — refinamento, não requisito
                opacity: hovered ? 1 : 0.5,
                transition: 'opacity 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-500)'; e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.opacity = hovered ? '1' : '0.5'; }}
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

          {/* Máximo já aparece no cabeçalho do popover — nada extra aqui */}
        </div>
      )}
    </td>
  );
}

// ── Linha de micro editável dentro do drawer ──────────────────────────────────

function MicroLinha({
  macro, micro, horas, alocacaoId, totalGeralAtual, token,
  onSave, saving, bloqueio, onClearBloqueio,
}: {
  macro:           { id: string };
  micro:           { id: string; nome: string };
  horas:           number;
  alocacaoId:      string | null;
  totalGeralAtual: number;
  token:           string;
  onSave:          (macroId: string, microId: string, horas: number, alocId: string | null) => Promise<void>;
  saving:          boolean;
  bloqueio:        BloqueioInfo | null;
  onClearBloqueio: () => void;
}) {
  const [val, setVal] = useState(horas > 0 ? fmtHoras(horas) : '');
  const activeRef     = useRef(false);

  useEffect(() => {
    if (!activeRef.current) setVal(horas > 0 ? fmtHoras(horas) : '');
  }, [horas]);

  const maxMicro = Math.max(0, TETO - totalGeralAtual + horas);

  async function confirm() {
    if (!activeRef.current) return;
    activeRef.current = false;
    onClearBloqueio();
    const h = parseFloat(val);
    if (horas > 0 && !isNaN(h) && Math.abs(h - horas) < 0.001) return;
    await onSave(macro.id, micro.id, isNaN(h) || h <= 0 ? 0 : h, alocacaoId);
  }

  const inputStyle: React.CSSProperties = {
    width: 60, textAlign: 'right', fontSize: 13, fontWeight: 600,
    background: 'var(--surface-1)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '3px 7px', color: 'var(--text-1)', outline: 'none',
    opacity: saving ? 0.45 : 1,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600,
            color: maxMicro <= 0 ? '#ef4444' : maxMicro < 20 ? '#f59e0b' : 'var(--text-3)' }}>
            {maxMicro <= 0 ? 'sem espaço' : `máx ${fmtHoras(maxMicro)}h`}
          </span>
          {saving ? (
            <span style={{ ...inputStyle, color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>...</span>
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

function Drawer({ info, token, onClose, onSaved }: { info: DrawerInfo; token: string; onClose: () => void; onSaved: () => void; }) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!drawerRef.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const { colabId, colabNome, projetoId, projCodigo, projNome, celula, saldo, ano, mes } = info;

  const [estrutura, setEstrutura]     = useState<MacroEstrutura[]>([]);
  const [loadingEstr, setLoadingEstr] = useState(true);

  type DetalheEntry = { alocacaoId: string; horas: number };
  const [detalheMap, setDetalheMap]   = useState<Record<string, DetalheEntry>>(() => {
    const m: Record<string, DetalheEntry> = {};
    if (celula) for (const d of celula.detalhes) m[d.microEntregaId] = { alocacaoId: d.alocacaoId, horas: parseFloat(d.horas) };
    return m;
  });

  const [totalGeralAtual, setTotalGeralAtual] = useState(parseFloat(saldo.totalGeral));
  const [savingMicroId, setSavingMicroId]     = useState<string | null>(null);
  const [bloqueioMap, setBloqueioMap]         = useState<Record<string, BloqueioInfo>>({});

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
          setDetalheMap(m => ({ ...m, [microId]: { alocacaoId: data.alocacao.id, horas } }));
          await refreshSaldo(); onSaved();
        } else if (res.status === 409 && data.bloqueado) {
          setBloqueioMap(m => ({ ...m, [microId]: data }));
        }
      }
    } catch { /* silently fail */ }
    setSavingMicroId(null);
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
                            totalGeralAtual={totalGeralAtual}
                            token={token}
                            onSave={handleSaveMicro}
                            saving={savingMicroId === micro.id}
                            bloqueio={bloqueioMap[micro.id] ?? null}
                            onClearBloqueio={() => setBloqueioMap(m => { const n = { ...m }; delete n[micro.id]; return n; })}
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
  const [resultados, setResultados] = useState<{ id: string; nome: string; funcao: string | null }[]>([]);
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
          const data: { id: string; nome: string; funcao: string | null; ativo: boolean }[] = await res.json();
          // Mostra TODOS os ativos — quem está no grid recebe badge, não é escondido
          setResultados(data.filter(c => c.ativo).slice(0, 8));
          setOpen(true);
        }
      } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query, token, idsNoGrid]);

  async function handleSelect(c: { id: string; nome: string; funcao: string | null }) {
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
      colaborador: { id: c.id, nome: c.nome, funcao: c.funcao },
      saldo: {
        totalMeusProj: String(totalMeusProj),
        totalOutros:   String(totalOutros),
        totalGeral:    String(totalGeral),
        disponivel:    String(disponivel),
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
                {c.funcao && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.funcao}</div>}
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
  const { token } = useAuth();

  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());

  const [data, setData]       = useState<GridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');

  // Colaboradores adicionados manualmente (sem alocação nos meus projetos ainda)
  const [extrasColabs, setExtrasColabs] = useState<ExtraLinha[]>([]);

  // Painel lateral de detalhamento
  const [drawer, setDrawer] = useState<DrawerInfo | null>(null);

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

  // Limpa os extras ao navegar para outro mês (são contextuais ao mês)
  useEffect(() => { setExtrasColabs([]); }, [ano, mes]);

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
        celulas:     Object.fromEntries(data.projetos.map(p => [p.id, null])) as Record<string, Celula | null>,
      }));
    return [...data.linhas, ...extras]
      .sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome, 'pt-BR'));
  }, [data, extrasColabs]);

  // IDs já no grid (para filtrar os resultados da busca)
  const idsNoGrid = useMemo(() => new Set(todasLinhas.map(l => l.colaborador.id)), [todasLinhas]);

  const fetchGrid = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
            <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
              {todasLinhas.length} colaborador{todasLinhas.length !== 1 ? 'es' : ''} ·{' '}
              {data.projetos.length} projeto{data.projetos.length !== 1 ? 's' : ''}
              {' '}· clique em célula para editar
            </span>
          </>
        )}
      </div>

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
            <p className="text-xs">Use <strong>/alocacoes</strong> para alocar colaboradores neste mês.</p>
          </div>
        )}

        {!loading && !erro && data && todasLinhas.length > 0 && (
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
                {data.projetos.map(p => (
                  <th key={p.id} style={{ ...thBase, textAlign: 'center', width: COL_PROJ_W }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-500)' }} title={p.nome}>{p.codigo}</div>
                    <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: COL_PROJ_W - 16 }} title={p.nome}>{p.nome}</div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {todasLinhas.map((linha, idx) => {
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
                      {linha.colaborador.funcao && (
                        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {linha.colaborador.funcao}
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
                        onSaved={fetchGrid}
                        onOpenDrawer={setDrawer}
                        projCodigo={p.codigo}
                        projNome={p.nome}
                        saldo={linha.saldo}
                        isHighlighted={isHighlight}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Drawer lateral de detalhamento */}
      {drawer && <Drawer info={drawer} token={token!} onClose={() => setDrawer(null)} onSaved={() => fetchGrid(true)} />}
    </div>
  );
}
