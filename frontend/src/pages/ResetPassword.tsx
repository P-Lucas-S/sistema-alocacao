import React, { useState, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Lock, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function ResetPassword() {
  const location = useLocation();
  const emailFromState = (location.state as { email?: string })?.email || '';

  const [email,       setEmail]       = useState(emailFromState);
  const [code,        setCode]        = useState<string[]>(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPwd,  setConfirmPwd]  = useState('');
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [loading,     setLoading]     = useState(false);
  const navigate = useNavigate();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newCode = [...code];
    for (let i = 0; i < 6; i++) {
      newCode[i] = pasted[i] || '';
    }
    setCode(newCode);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const codeString = code.join('');
    if (codeString.length !== 6) {
      setError('Preencha o código completo de 6 dígitos.');
      return;
    }
    if (newPassword.length < 6) {
      setError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPwd) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: codeString, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || 'Senha redefinida com sucesso!');
        setTimeout(() => navigate('/login'), 2500);
      } else {
        setError(data.error || 'Erro ao redefinir senha.');
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

  const codeInputStyle: React.CSSProperties = {
    width: 44, height: 52, textAlign: 'center', fontSize: 22, fontWeight: 700,
    background: 'var(--surface-1)',
    border: '2px solid var(--border)',
    borderRadius: 12,
    color: 'var(--text-1)',
    outline: 'none',
    transition: 'border-color 200ms, box-shadow 200ms',
    fontFamily: 'inherit',
  };

  const onCodeFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'var(--brand-500)';
    e.target.style.boxShadow   = '0 0 0 3px rgb(99 102 241 / 0.15)';
  };
  const onCodeBlur  = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = 'var(--border)';
    e.target.style.boxShadow   = 'none';
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
            Redefinir senha
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55 }}>
            Informe o código de 6 dígitos recebido por email e sua nova senha.
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

          {/* Email input (only shown when NOT coming from ForgotPassword) */}
          {!emailFromState && (
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                color: 'var(--text-2)', marginBottom: 6,
              }}>
                Email
              </label>
              <input
                type="email" required autoComplete="email" placeholder="seu@email.com"
                value={email} onChange={e => setEmail(e.target.value)}
                className="form-input"
              />
            </div>
          )}

          {/* Email display (when pre-filled from ForgotPassword) */}
          {emailFromState && (
            <div style={{
              padding: '10px 14px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 2px' }}>Enviado para:</p>
              <p style={{ fontSize: 14, color: 'var(--text-1)', margin: 0, fontWeight: 600 }}>{emailFromState}</p>
            </div>
          )}

          {/* 6-digit code */}
          <div>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--text-2)', marginBottom: 10,
            }}>
              Código de verificação
            </label>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }} onPaste={handleCodePaste}>
              {code.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleCodeChange(i, e.target.value)}
                  onKeyDown={e => handleCodeKeyDown(i, e)}
                  onFocus={onCodeFocus}
                  onBlur={onCodeBlur}
                  style={codeInputStyle}
                  autoComplete="off"
                />
              ))}
            </div>
          </div>

          {/* New password */}
          <div>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--text-2)', marginBottom: 6,
            }}>
              Nova senha
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={iconStyle} />
              <input
                type="password" required autoComplete="new-password"
                placeholder="Mínimo 6 caracteres"
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                className="form-input"
                style={{ paddingLeft: 40 }}
              />
            </div>
          </div>

          {/* Confirm password */}
          <div>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--text-2)', marginBottom: 6,
            }}>
              Confirmar senha
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={iconStyle} />
              <input
                type="password" required autoComplete="new-password"
                placeholder="Repita a nova senha"
                value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                className="form-input"
                style={{ paddingLeft: 40 }}
              />
            </div>
          </div>

          {/* Submit */}
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
                Redefinindo…
              </>
            ) : 'Redefinir senha'}
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
