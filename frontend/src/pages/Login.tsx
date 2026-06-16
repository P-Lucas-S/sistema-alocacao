import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Mail, Lock, AlertCircle, Eye, EyeOff,
  LayoutGrid, Shield, ArrowLeftRight,
} from 'lucide-react';

const features = [
  { icon: LayoutGrid,     text: 'Planejamento mensal por colaborador e projeto' },
  { icon: Shield,         text: 'Teto de 220h que evita sobrecarga' },
  { icon: ArrowLeftRight, text: 'Remanejamento de horas entre gestores' },
];

export default function Login() {
  const [email,        setEmail]        = useState(() => localStorage.getItem('savedEmail') || '');
  const [password,     setPassword]     = useState('');
  const [rememberMe,   setRememberMe]   = useState(() => !!localStorage.getItem('savedEmail'));
  const [showPassword, setShowPassword] = useState(false);
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const { login }  = useAuth();
  const navigate   = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      const data = await res.json();
      if (res.ok) {
        if (rememberMe) {
          localStorage.setItem('savedEmail', email);
        } else {
          localStorage.removeItem('savedEmail');
        }
        login(data.token, data.user, rememberMe);
        navigate('/');
      } else {
        setError(data.error || 'Email ou senha inválidos.');
      }
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const iconStyle: React.CSSProperties = {
    position: 'absolute', left: 13, top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-3)', pointerEvents: 'none',
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface-2)', padding: '24px 16px',
    }}>
      {/* Responsive: hide left panel below md */}
      <style>{`@media(min-width:768px){ .login-left { display: flex !important; } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 940,
        display: 'flex', borderRadius: 16,
        border: '1px solid var(--border)',
        boxShadow: '0 8px 40px rgb(0 0 0 / 0.07)',
        overflow: 'hidden',
      }}>

        {/* ═══ LEFT — introdução ═══ */}
        <div
          className="login-left"
          style={{
            flex: 1, display: 'none',
            flexDirection: 'column', justifyContent: 'space-between',
            padding: '44px 40px',
            background: 'var(--surface-2)',
            borderRight: '1px solid var(--border)',
          }}
        >
          {/* Marca */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'var(--brand-600)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 18, lineHeight: 1 }}>A</span>
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Sistema de Alocação</p>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Gestão de Equipes</p>
            </div>
          </div>

          {/* Manchete + features */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '44px 0' }}>
            <h2 style={{
              fontSize: 25, fontWeight: 600, color: 'var(--text-1)',
              lineHeight: 1.35, margin: '0 0 14px', maxWidth: 340,
            }}>
              Planeje a alocação da equipe, sem sobrecarga.
            </h2>
            <p style={{
              fontSize: 14, color: 'var(--text-2)', lineHeight: 1.65,
              margin: '0 0 32px', maxWidth: 360,
            }}>
              Quem trabalha em quê, mês a mês, com um teto de horas que protege
              cada pessoa, mesmo quando vários gestores disputam a mesma equipe.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {features.map(({ icon: Icon, text }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'var(--brand-50)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: 1,
                  }}>
                    <Icon size={15} color="var(--brand-600)" />
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-1)', margin: 0, paddingTop: 7, lineHeight: 1.45 }}>
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Rodapé do painel */}
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
            Sistema de Alocação · 2026
          </p>
        </div>

        {/* ═══ RIGHT — formulário ═══ */}
        <div style={{
          width: '100%', maxWidth: 420, flexShrink: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: '48px 40px',
          background: 'var(--surface-1)',
        }}>

          {/* Título */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: 'var(--text-1)' }}>
              Bem-vindo de volta
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-3)' }}>
              Entre na sua conta para continuar
            </p>
          </div>

          {/* Erro */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px',
              background: 'hsl(0 85% 60% / 0.08)',
              border: '1px solid hsl(0 85% 60% / 0.25)',
              borderRadius: 10, fontSize: 13, color: '#b42318',
              marginBottom: 16,
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* E-mail */}
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                color: 'var(--text-2)', marginBottom: 6,
              }}>
                E-mail
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={iconStyle} />
                <input
                  type="email" required autoComplete="email"
                  placeholder="seu@email.com"
                  value={email} onChange={e => setEmail(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: 40 }}
                />
              </div>
            </div>

            {/* Senha */}
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                color: 'var(--text-2)', marginBottom: 6,
              }}>
                Senha
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} style={iconStyle} />
                <input
                  type={showPassword ? 'text' : 'password'} required
                  autoComplete="current-password" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: 40, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 13, top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none', padding: 0,
                    cursor: 'pointer', color: 'var(--text-3)', display: 'flex',
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Lembrar-me + Esqueceu a senha */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', fontSize: 13, color: 'var(--text-2)',
                  userSelect: 'none',
                }}
                onClick={() => setRememberMe(!rememberMe)}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: 5,
                  border: `2px solid ${rememberMe ? 'var(--brand-500)' : 'var(--border-strong)'}`,
                  background: rememberMe ? 'var(--brand-500)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 200ms ease', flexShrink: 0,
                }}>
                  {rememberMe && (
                    <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                      <path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                Lembrar-me
              </label>

              <Link
                to="/forgot-password"
                style={{ fontSize: 13, color: 'var(--brand-600)', textDecoration: 'none', transition: 'opacity 150ms' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.75'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                Esqueceu a senha?
              </Link>
            </div>

            {/* Entrar */}
            <button
              type="submit"
              className="btn-brand"
              disabled={loading}
              style={{ width: '100%', padding: '12px', fontSize: 15, borderRadius: 10, marginTop: 4 }}
            >
              {loading ? (
                <>
                  <svg style={{ width: 16, height: 16, animation: 'spin 0.8s linear infinite' }} viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                    <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Entrando…
                </>
              ) : 'Entrar'}
            </button>

          </form>

          {/* Rodapé */}
          <p style={{ marginTop: 32, textAlign: 'center', fontSize: 12, color: 'var(--text-3)' }}>
            Sistema de Alocação © 2026
          </p>
        </div>

      </div>
    </div>
  );
}
