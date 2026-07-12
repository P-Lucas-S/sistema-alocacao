import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search } from 'lucide-react';

export interface ComboboxOption {
  id: string;
  nome: string;
  inativo?: boolean;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  showIcon?: boolean;
}

// Mesma ideia de normalização usada no backend (normalize.ts/colaboradores.ts):
// lowercase + NFD + remove diacríticos, pra busca ignorar acento/caixa.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none', width: '100%',
};

export default function Combobox({ options, value, onChange, placeholder, disabled, required, showIcon }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const selected = options.find(o => o.id === value) ?? null;

  // Fechado: mostra o nome da opção selecionada. Aberto: modo-busca (o que foi digitado).
  const displayValue = open ? query : (selected?.nome ?? '');

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return options;
    return options.filter(o => normalize(o.nome).includes(q));
  }, [options, query]);

  // Clique fora fecha — listener de mousedown no document, só enquanto aberto.
  // (NÃO usa onBlur: clicar numa opção dispara blur ANTES do click, o que
  // engoliria a seleção; mousedown na própria opção chega antes deste handler
  // global, então containerRef.current.contains(target) ainda é true pra ele.)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, open]);

  // Acompanha o destaque por teclado: rola o item destacado pra dentro da área
  // visível do dropdown (scroll do CONTAINER, não da página — block: 'nearest'
  // rola o mínimo necessário; sem behavior smooth, pra não atrasar a navegação).
  useEffect(() => {
    if (!open || filtered.length === 0) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, filtered, highlightedIndex]);

  function openDropdown() {
    if (disabled) return;
    setQuery('');
    setOpen(true);
  }

  function selectOption(opt: ComboboxOption) {
    onChange(opt.id);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlightedIndex];
      if (opt) selectOption(opt);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {showIcon && (
        <Search
          size={13}
          style={{
            position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-3)', pointerEvents: 'none', zIndex: 1,
          }}
        />
      )}
      <input
        type="text"
        value={displayValue}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
        style={{
          ...inputStyle,
          ...(showIcon ? { paddingLeft: 28 } : {}),
          ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
        }}
      />
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: 'var(--shadow-lg)',
            maxHeight: 220, overflowY: 'auto', zIndex: 70,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-3)' }}>
              Nenhum resultado
            </div>
          ) : (
            filtered.map((opt, i) => (
              <div
                key={opt.id}
                ref={el => { optionRefs.current[i] = el; }}
                onMouseDown={e => { e.preventDefault(); selectOption(opt); }}
                onMouseEnter={() => setHighlightedIndex(i)}
                style={{
                  padding: '8px 12px', fontSize: 14, cursor: 'pointer',
                  background: i === highlightedIndex ? 'var(--surface-2)' : 'transparent',
                  color: opt.inativo ? 'var(--text-3)' : 'var(--text-1)',
                }}
              >
                {opt.nome}{opt.inativo ? ' (inativo)' : ''}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
