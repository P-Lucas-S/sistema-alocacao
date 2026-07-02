import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

interface Props {
  mes: number;
  ano: number;
  onMes: (m: number) => void;
  onAno: (a: number) => void;
}

export default function SeletorMes({ mes, ano, onMes, onAno }: Props) {
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
