import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function ForgotPassword() {
  const [email,   setEmail]   = useState('');
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || 'Código de recuperação enviado para o seu email.');
        setTimeout(() => navigate('/reset-password', { state: { email } }), 2000);
      } else {
        setError(data.error || 'Erro ao enviar código de recuperação.');
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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{
        width: '100%', maxWidth: 420,
        background: 'var(--surface-1)',
        borderRadius: 16,
        border: '1px solid var(--border)',
        boxShadow: '0 8px 40px rgb(0 0 0 / 0.07)',
        padding: '48px 40px',
      }}>

        {/* Brand mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
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

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: 'var(--text-1)' }}>
            Esqueceu a senha?
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55 }}>
            Informe seu email e enviaremos um código de 6 dígitos para redefinir sua senha.
          </p>
        </div>

        {/* Error */}
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

        {/* Success */}
        {success && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px',
            background: 'hsl(142 76% 36% / 0.08)',
            border: '1px solid hsl(142 76% 36% / 0.25)',
            borderRadius: 10, fontSize: 13, color: '#15803d',
            marginBottom: 16,
          }}>
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
            {success}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--text-2)', marginBottom: 6,
            }}>
              Email
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
                Enviando…
              </>
            ) : 'Enviar código'}
          </button>
        </form>

        {/* Back to login */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link
            to="/login"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, color: 'var(--brand-600)',
              textDecoration: 'none', transition: 'opacity 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.75'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            <ArrowLeft size={14} /> Voltar ao login
          </Link>
        </div>

      </div>
    </div>
  );
}
