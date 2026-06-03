import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserPlus, Users, Shield, Briefcase, Mail, X, KeyRound, UserCheck, Eye, Pencil, Trash2, AlertTriangle } from 'lucide-react';


const COLORS = ['#818cf8','#34d399','#fb923c','#f472b6','#60a5fa','#a78bfa','#2dd4bf'];
const avatarColor = (name: string) => COLORS[name.charCodeAt(0) % COLORS.length];
const initials = (name: string) => name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();

const PREDEFINED_POSITIONS = ['Designer', 'Redator', 'Editor de Vídeo', 'Motion Designer'];

const ROLE_CONFIG: Record<string, { label: string; icon: React.ReactNode; bg: string; color: string }> = {
  admin:       { label: 'Admin',       icon: <Shield size={10} className="inline mr-0.5" />,    bg: 'hsl(265 90% 60% / 0.15)', color: '#a78bfa' },
  gestor:      { label: 'Gestor',      icon: <UserCheck size={10} className="inline mr-0.5" />, bg: 'hsl(38 92% 50% / 0.15)',  color: '#fbbf24' },
  coordenacao: { label: 'Coordenação', icon: <Eye size={10} className="inline mr-0.5" />,       bg: 'hsl(210 90% 56% / 0.15)', color: '#60a5fa' },
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
      {label}
    </label>
    {children}
  </div>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="input-field"
    style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '8px 12px',
      color: 'var(--text-1)',
      fontSize: 14,
      outline: 'none',
      width: '100%',
    }}
  />
);

const selectStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '8px 12px',
  color: 'var(--text-1)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
};

export default function Team() {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isModalOpen, setIsOpen]  = useState(false);
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [role, setRole]           = useState('gestor');
  const [position, setPosition]   = useState('');
  const [customPosition, setCustomPosition] = useState('');
  const [error, setError]         = useState('');
  const [resetTarget, setResetTarget]       = useState<any>(null);
  const [newPassword, setNewPassword]       = useState('');
  const [resetSuccess, setResetSuccess]     = useState('');
  const [emailFeedback, setEmailFeedback]   = useState<{ type: 'success' | 'warning'; message: string } | null>(null);

  const [editTarget, setEditTarget]         = useState<any>(null);
  const [editRole, setEditRole]             = useState('');
  const [editPosition, setEditPosition]     = useState('');
  const [editCustomPosition, setEditCustomPosition] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  useEffect(() => { fetchUsers(); }, [token]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUsers(await res.json());
    } finally { setLoading(false); }
  };

  const getEffectivePosition = () => position === '__custom__' ? customPosition : position;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, email, password, role, position: getEffectivePosition() }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsOpen(false);
        setName(''); setEmail(''); setPassword(''); setRole('gestor'); setPosition(''); setCustomPosition('');
        fetchUsers();
        if (data.emailSent) {
          setEmailFeedback({ type: 'success', message: `Email de boas-vindas enviado para ${data.email}` });
        } else {
          setEmailFeedback({ type: 'warning', message: `Usuário criado, mas o email não pôde ser enviado.` });
        }
        setTimeout(() => setEmailFeedback(null), 5000);
      } else {
        const d = await res.json();
        setError(d.error || 'Falha ao criar usuário');
      }
    } catch { setError('Erro de rede'); }
  };

  const handleResetPassword = async () => {
    if (!resetTarget || !newPassword) return;
    setError('');
    try {
      const res = await fetch(`/api/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword }),
      });
      if (res.ok) {
        setResetSuccess(`Senha redefinida para ${resetTarget.name}`);
        setTimeout(() => setResetSuccess(''), 3000);
        setResetTarget(null);
        setNewPassword('');
      } else {
        const d = await res.json();
        setError(d.error || 'Falha ao redefinir senha');
      }
    } catch { setError('Erro de rede'); }
  };

  const openEditModal = (u: any) => {
    setEditTarget(u);
    setEditRole(u.role);
    const isPredefined = PREDEFINED_POSITIONS.includes(u.position);
    setEditPosition(isPredefined ? u.position : (u.position ? '__custom__' : ''));
    setEditCustomPosition(isPredefined ? '' : (u.position || ''));
    setError('');
  };

  const getEditEffectivePosition = () => editPosition === '__custom__' ? editCustomPosition : editPosition;

  const handleEditUser = async () => {
    if (!editTarget) return;
    setError('');
    try {
      const res = await fetch(`/api/users/${editTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: editRole, position: getEditEffectivePosition() }),
      });
      if (res.ok) {
        setResetSuccess(`${editTarget.name} atualizado com sucesso`);
        setTimeout(() => setResetSuccess(''), 3000);
        setEditTarget(null);
        fetchUsers();
      } else {
        const d = await res.json();
        setError(d.error || 'Falha ao atualizar usuário');
      }
    } catch { setError('Erro de rede'); }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setResetSuccess(`${deleteTarget.name} foi excluído`);
        setTimeout(() => setResetSuccess(''), 3000);
        setDeleteTarget(null);
        fetchUsers();
      } else {
        const d = await res.json();
        setError(d.error || 'Falha ao excluir usuário');
        setDeleteTarget(null);
      }
    } catch { setError('Erro de rede'); setDeleteTarget(null); }
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <Users size={20} style={{ color: 'var(--brand-500)' }} />
            Equipe
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
            {loading ? '…' : `${users.length} usuário${users.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {resetSuccess && (
          <div className="text-xs font-medium px-3 py-1.5 rounded-lg animate-pulse" style={{ background: 'hsl(142 71% 45% / 0.12)', color: '#4ade80', border: '1px solid hsl(142 71% 45% / 0.25)' }}>
            ✓ {resetSuccess}
          </div>
        )}
        {emailFeedback && (
          <div className="text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{
            background: emailFeedback.type === 'success' ? 'hsl(142 71% 45% / 0.12)' : 'hsl(38 92% 50% / 0.12)',
            color: emailFeedback.type === 'success' ? '#4ade80' : '#fbbf24',
            border: `1px solid ${emailFeedback.type === 'success' ? 'hsl(142 71% 45% / 0.25)' : 'hsl(38 92% 50% / 0.25)'}`,
          }}>
            <Mail size={12} />
            {emailFeedback.message}
          </div>
        )}
        {isAdmin && (
          <button className="btn-primary flex items-center gap-2" onClick={() => setIsOpen(true)}>
            <UserPlus size={16} />
            <span>Novo Usuário</span>
          </button>
        )}
      </div>

      {/* User cards */}
      {loading ? (
        <div className="flex items-center gap-2 py-8" style={{ color: 'var(--text-3)' }}>
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Carregando equipe…
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {users.map(u => {
            const ac = avatarColor(u.name);
            const rc = ROLE_CONFIG[u.role] || { label: u.role, icon: null, bg: 'hsl(0 0% 50% / 0.15)', color: 'var(--text-3)' };
            const isSelf = currentUser?.id === u.id;
            return (
              <div
                key={u.id}
                className="rounded-2xl p-4 flex items-start gap-4 transition-all"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-strong)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: ac + '22', color: ac }}>
                  {initials(u.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>{u.name}</span>
                    <span className="badge shrink-0" style={{ background: rc.bg, color: rc.color }}>{rc.icon}{rc.label}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs truncate" style={{ color: 'var(--text-3)' }}>
                    <Mail size={11} />
                    <span className="truncate">{u.email}</span>
                  </div>
                  {u.position && (
                    <div className="flex items-center gap-1 mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                      <Briefcase size={11} />
                      <span>{u.position}</span>
                    </div>
                  )}
                  {isAdmin && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <button onClick={() => openEditModal(u)} className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-all" style={{ color: 'var(--text-3)', background: 'transparent', border: '1px solid var(--border)' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}>
                        <Pencil size={12} /> Editar
                      </button>
                      <button onClick={() => { setResetTarget(u); setNewPassword(''); setError(''); }} className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-all" style={{ color: 'var(--text-3)', background: 'transparent', border: '1px solid var(--border)' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--brand-500)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}>
                        <KeyRound size={12} /> Senha
                      </button>
                      {!isSelf && (
                        <button onClick={() => setDeleteTarget(u)} className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-all" style={{ color: 'var(--text-3)', background: 'transparent', border: '1px solid var(--border)' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'hsl(0 85% 60% / 0.1)'; (e.currentTarget as HTMLElement).style.color = 'hsl(0 85% 65%)'; (e.currentTarget as HTMLElement).style.borderColor = 'hsl(0 85% 60% / 0.3)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
                          <Trash2 size={12} /> Excluir
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'hsl(0 0% 0% / 0.5)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setIsOpen(false); }}>
          <div className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Adicionar Usuário</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Preencha os dados do novo usuário.</p>
              </div>
              <button onClick={() => setIsOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ color: 'var(--text-3)' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <X size={16} />
              </button>
            </div>
            {error && <div className="text-xs p-3 rounded-lg" style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 65%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>{error}</div>}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Field label="Nome"><Input type="text" required placeholder="João Silva" value={name} onChange={e => setName(e.target.value)} /></Field>
              <Field label="Email"><Input type="email" required placeholder="joao@empresa.com" value={email} onChange={e => setEmail(e.target.value)} /></Field>
              <Field label="Senha"><Input type="password" required placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Função">
                  <select value={position} onChange={e => { setPosition(e.target.value); if (e.target.value !== '__custom__') setCustomPosition(''); }} style={selectStyle}>
                    <option value="">Selecione...</option>
                    {PREDEFINED_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="__custom__">Outra (personalizada)</option>
                  </select>
                  {position === '__custom__' && <Input type="text" placeholder="Digite a função" value={customPosition} onChange={e => setCustomPosition(e.target.value)} style={{ marginTop: 6 }} />}
                </Field>
                <Field label="Acesso">
                  <select value={role} onChange={e => setRole(e.target.value)} style={selectStyle}>
                    <option value="gestor">Gestor</option>
                    <option value="coordenacao">Coordenação</option>
                    <option value="admin">Admin</option>
                  </select>
                </Field>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsOpen(false)} className="btn-ghost flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1">Adicionar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'hsl(0 0% 0% / 0.5)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Editar Usuário</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Editando <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{editTarget.name}</span></p>
              </div>
              <button onClick={() => setEditTarget(null)} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ color: 'var(--text-3)' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <X size={16} />
              </button>
            </div>
            {error && <div className="text-xs p-3 rounded-lg" style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 65%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>{error}</div>}
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Função">
                  <select value={editPosition} onChange={e => { setEditPosition(e.target.value); if (e.target.value !== '__custom__') setEditCustomPosition(''); }} style={selectStyle}>
                    <option value="">Sem função</option>
                    {PREDEFINED_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="__custom__">Outra (personalizada)</option>
                  </select>
                  {editPosition === '__custom__' && <Input type="text" placeholder="Digite a função" value={editCustomPosition} onChange={e => setEditCustomPosition(e.target.value)} style={{ marginTop: 6 }} />}
                </Field>
                <Field label="Acesso">
                  <select value={editRole} onChange={e => setEditRole(e.target.value)} style={selectStyle}>
                    <option value="gestor">Gestor</option>
                    <option value="coordenacao">Coordenação</option>
                    <option value="admin">Admin</option>
                  </select>
                </Field>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditTarget(null)} className="btn-ghost flex-1">Cancelar</button>
                <button onClick={handleEditUser} className="btn-primary flex-1 flex items-center justify-center gap-2"><Pencil size={14} />Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'hsl(0 0% 0% / 0.5)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface-1)', border: '1px solid hsl(0 85% 60% / 0.3)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'hsl(0 85% 60% / 0.12)', color: 'hsl(0 85% 65%)' }}><AlertTriangle size={20} /></div>
              <div>
                <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Excluir Usuário</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Esta ação não pode ser desfeita.</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              Tem certeza que deseja excluir <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{deleteTarget.name}</span>?
            </p>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={handleDeleteUser} className="flex-1 flex items-center justify-center gap-2 font-semibold text-sm py-2 px-4 rounded-xl transition-all" style={{ background: 'hsl(0 85% 60%)', color: '#fff' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'hsl(0 85% 50%)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'hsl(0 85% 60%)'}>
                <Trash2 size={14} /> Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'hsl(0 0% 0% / 0.5)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setResetTarget(null); }}>
          <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Redefinir Senha</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Nova senha para <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{resetTarget.name}</span></p>
              </div>
              <button onClick={() => setResetTarget(null)} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ color: 'var(--text-3)' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <X size={16} />
              </button>
            </div>
            {error && <div className="text-xs p-3 rounded-lg" style={{ background: 'hsl(0 85% 60% / 0.1)', color: 'hsl(0 85% 65%)', border: '1px solid hsl(0 85% 60% / 0.2)' }}>{error}</div>}
            <Field label="Nova Senha"><Input type="password" required placeholder="Mínimo 6 caracteres" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Field>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setResetTarget(null)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={handleResetPassword} disabled={newPassword.length < 6} className="btn-primary flex-1 flex items-center justify-center gap-2" style={{ opacity: newPassword.length < 6 ? 0.5 : 1 }}>
                <KeyRound size={14} /> Redefinir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
