import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useGestorFiltro } from '../context/GestorFiltroContext';

// Papéis que veem o seletor — não inclui 'gestor' (cosmética; a barreira real é o backend).
const PAPEIS_AMPLOS = ['admin', 'chefe', 'coordenacao', 'diretor'] as const;

interface GestorOpcao {
  id: string;
  name: string;
}

export default function SeletorGestor() {
  const { user, token } = useAuth();
  const { gestorIdFiltro, setGestorIdFiltro } = useGestorFiltro();
  const [gestores, setGestores] = useState<GestorOpcao[]>([]);

  const podeVer = PAPEIS_AMPLOS.includes(user?.role as typeof PAPEIS_AMPLOS[number]);

  useEffect(() => {
    if (!podeVer || !token) return;
    fetch('/api/users/gestores', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((gestores: GestorOpcao[]) => setGestores(gestores))
      .catch(() => {});
  }, [podeVer, token]);

  if (!podeVer) return null;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
        Ver como:
      </span>
      <select
        value={gestorIdFiltro ?? ''}
        onChange={e => setGestorIdFiltro(e.target.value || undefined)}
        style={{
          background: 'var(--surface-2)', border: `1px solid ${gestorIdFiltro ? 'var(--brand-500)' : 'var(--border)'}`,
          borderRadius: 8, padding: '4px 8px', fontSize: 13,
          color: gestorIdFiltro ? 'var(--brand-500)' : 'var(--text-1)',
          outline: 'none', cursor: 'pointer', fontWeight: gestorIdFiltro ? 600 : 400,
          maxWidth: 180,
        }}
      >
        <option value=''>Todos os gestores</option>
        {gestores.map(g => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
    </div>
  );
}
