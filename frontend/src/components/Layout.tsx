import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LogOut, LayoutDashboard, Users, Moon, Sun } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import NotificationBell from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  end?: boolean;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Início', icon: LayoutDashboard, end: true },
  { to: '/team', label: 'Equipe', icon: Users, adminOnly: true },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const initial = user?.name?.charAt(0).toUpperCase() ?? '?';

  const visibleItems = NAV_ITEMS.filter(item => !item.adminOnly || user?.role === 'admin');

  return (
    <div className="flex h-screen overflow-hidden relative" style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}>
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside
        className="w-56 flex flex-col shrink-0"
        style={{
          background: 'var(--surface-1)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Logo */}
        <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <p className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
            Sistema de Alocação
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            Gestão de Equipes
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2.5 py-3 space-y-0.5">
          {visibleItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive ? 'nav-active' : 'hover:bg-[var(--surface-3)]'
                }`
              }
              style={({ isActive }) => isActive ? {} : { color: 'var(--text-2)' }}
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} style={{ opacity: isActive ? 1 : 0.65 }} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-2.5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <NavLink
            to="/profile"
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg mb-1 transition-all duration-150"
            style={({ isActive }) => ({
              background: isActive ? 'var(--brand-50)' : 'var(--surface-2)',
              border: isActive ? '1px solid var(--brand-200)' : '1px solid transparent',
            })}
          >
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="w-8 h-8 rounded-full object-cover shrink-0"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
                style={{ background: 'var(--grad-brand)', boxShadow: '0 2px 8px rgb(79 70 229 / 0.35)' }}
              >
                {initial}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[13px] font-semibold truncate leading-tight" style={{ color: 'var(--text-1)' }}>
                {user?.name}
              </p>
              <p className="text-[11px] truncate leading-tight capitalize" style={{ color: 'var(--text-3)' }}>
                {user?.position || user?.role}
              </p>
            </div>
          </NavLink>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#ef4444';
              e.currentTarget.style.background = 'rgb(254 242 242)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--text-3)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <LogOut size={14} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 shrink-0 flex items-center justify-end px-6" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-3)] shrink-0"
              style={{ color: 'var(--text-2)' }}
              title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-x-auto overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
