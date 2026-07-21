import React from 'react';

export default function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '16px 20px',
    }}>
      <h2 style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14,
      }}>
        {titulo}
      </h2>
      {children}
    </div>
  );
}
