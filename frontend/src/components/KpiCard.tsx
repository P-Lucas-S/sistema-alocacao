import React from 'react';

export default function KpiCard({ label, value, valueColor }: {
  label:       string;
  value:       string | number;
  valueColor?: string;
}) {
  const isStr = typeof value === 'string';
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--text-3)',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: isStr ? 18 : 28,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
        color: valueColor ?? 'var(--text-1)',
      }}>
        {value}
      </span>
    </div>
  );
}
