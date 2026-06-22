import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserCircle, Camera, Check, AlertCircle, Lock, Pencil, X, ZoomIn, ZoomOut } from 'lucide-react';
import Cropper, { Area } from 'react-easy-crop';

/* ─── Utilitário: recorta imagem via Canvas ─── */
function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.setAttribute('crossOrigin', 'anonymous');
    img.src = url;
  });
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const size = Math.min(pixelCrop.width, pixelCrop.height);
  canvas.width = size;
  canvas.height = size;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    size,
    size,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob falhou'));
    }, 'image/jpeg', 0.92);
  });
}

/* ─── Componente ─── */
export default function Profile() {
  const { user, token, updateUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  // Name editing
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [nameLoading, setNameLoading] = useState(false);

  // Password
  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // Crop modal
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [cropLoading, setCropLoading] = useState(false);

  // Feedback
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const flash = (msg: string, type: 'success' | 'error') => {
    if (type === 'success') { setSuccess(msg); setError(''); }
    else { setError(msg); setSuccess(''); }
    setTimeout(() => { setSuccess(''); setError(''); }, 3500);
  };

  const initial = user?.name?.charAt(0).toUpperCase() ?? '?';

  // --- Handlers ---
  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === user?.name) {
      setEditingName(false);
      return;
    }
    setNameLoading(true);
    try {
      const res = await fetch('/api/profile/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      updateUser(data);
      setEditingName(false);
      flash('Nome atualizado!', 'success');
    } catch {
      flash('Erro ao atualizar nome.', 'error');
    } finally {
      setNameLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPw || !newPw) return;
    if (newPw.length < 4) { flash('A nova senha deve ter pelo menos 4 caracteres.', 'error'); return; }
    setPwLoading(true);
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (res.status === 401) { flash('Senha atual incorreta.', 'error'); return; }
      if (!res.ok) throw new Error();
      setShowPwForm(false);
      setCurrentPw('');
      setNewPw('');
      flash('Senha alterada com sucesso!', 'success');
    } catch {
      flash('Erro ao alterar senha.', 'error');
    } finally {
      setPwLoading(false);
    }
  };

  /* Abre o modal com a imagem selecionada */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setImageSrc(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCropModalOpen(true);
    });
    reader.readAsDataURL(file);
    // Limpar value para permitir re-selecionar o mesmo arquivo
    e.target.value = '';
  };

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  /* Recorta e faz upload */
  const handleCropSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setCropLoading(true);
    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      const form = new FormData();
      form.append('avatar', croppedBlob, 'avatar.jpg');

      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      updateUser(data);
      setCropModalOpen(false);
      setImageSrc(null);
      flash('Foto atualizada!', 'success');
    } catch {
      flash('Erro ao enviar foto.', 'error');
    } finally {
      setCropLoading(false);
    }
  };

  const handleCropCancel = () => {
    setCropModalOpen(false);
    setImageSrc(null);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 rounded-xl bg-indigo-500/20">
          <UserCircle size={24} className="text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Meu Perfil</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Gerencie suas informações pessoais</p>
        </div>
      </div>

      {/* Feedback */}
      {success && (
        <div
          className="mb-4 p-3 rounded-lg text-sm flex items-center gap-2"
          style={{ background: 'hsl(142 76% 36% / 0.08)', border: '1px solid hsl(142 76% 36% / 0.25)', color: '#15803d' }}
        >
          <Check size={16} /> {success}
        </div>
      )}
      {error && (
        <div
          className="mb-4 p-3 rounded-lg text-sm flex items-center gap-2"
          style={{ background: 'hsl(0 85% 60% / 0.08)', border: '1px solid hsl(0 85% 60% / 0.25)', color: '#b42318' }}
        >
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Avatar + Name Card */}
        <div className="card p-6">
          <div className="flex items-center gap-5">
            {/* Avatar */}
            <div className="relative group">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="w-20 h-20 rounded-full object-cover border-2"
                  style={{ borderColor: 'var(--border)' }}
                />
              ) : (
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white border-2"
                  style={{ background: 'var(--grad-brand)', borderColor: 'var(--border)' }}
                >
                  {initial}
                </div>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                <Camera size={20} className="text-white" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            {/* Name + Email */}
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex gap-2 items-center">
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                    className="flex-1 form-input text-sm"
                    style={{ padding: '0.375rem 0.75rem' }}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={nameLoading}
                    className="btn-brand"
                    style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', borderRadius: 8 }}
                  >
                    {nameLoading ? '...' : 'Salvar'}
                  </button>
                  <button
                    onClick={() => { setEditingName(false); setName(user?.name ?? ''); }}
                    className="btn-ghost"
                    style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', borderRadius: 8 }}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--text-1)' }}>{user?.name}</h2>
                  <button
                    onClick={() => setEditingName(true)}
                    className="p-1 rounded-lg transition-colors"
                    style={{ color: 'var(--text-2)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text-1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)'; }}
                    title="Editar nome"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              )}
              <p className="text-sm truncate mt-0.5" style={{ color: 'var(--text-2)' }}>{user?.email}</p>
              <p className="text-xs capitalize mt-0.5" style={{ color: 'var(--text-3)' }}>
                {user?.position ?? user?.role}
              </p>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Lock size={16} style={{ color: 'var(--text-2)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>Alterar Senha</h2>
            </div>
            {!showPwForm && (
              <button
                onClick={() => setShowPwForm(true)}
                className="btn-ghost"
                style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', borderRadius: 8 }}
              >
                Alterar
              </button>
            )}
          </div>

          {showPwForm && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-2)' }}>Senha atual</label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  className="form-input"
                  placeholder="••••••"
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-2)' }}>Nova senha</label>
                <input
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
                  className="form-input"
                  placeholder="Mínimo 4 caracteres"
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => { setShowPwForm(false); setCurrentPw(''); setNewPw(''); }}
                  className="btn-ghost"
                  style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', borderRadius: 8 }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleChangePassword}
                  disabled={pwLoading || !currentPw || !newPw}
                  className="btn-brand"
                  style={{ padding: '0.375rem 1rem', fontSize: '0.75rem', borderRadius: 8 }}
                >
                  {pwLoading ? 'Salvando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal de Recorte ── */}
      {cropModalOpen && imageSrc && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
          onClick={e => { if (e.target === e.currentTarget) handleCropCancel(); }}
        >
          <div
            className="relative w-full max-w-md mx-4 rounded-2xl overflow-hidden"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>Ajustar foto de perfil</h3>
              <button
                onClick={handleCropCancel}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--text-2)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text-1)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)'; }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Crop area */}
            <div className="relative w-full" style={{ height: 320 }}>
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                style={{
                  containerStyle: { background: '#000' },
                }}
              />
            </div>

            {/* Zoom slider */}
            <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: '1px solid var(--border)' }}>
              <ZoomOut size={16} className="shrink-0" style={{ color: 'var(--text-2)' }} />
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #6366f1 ${((zoom - 1) / 2) * 100}%, var(--border-strong) ${((zoom - 1) / 2) * 100}%)`,
                }}
              />
              <ZoomIn size={16} className="shrink-0" style={{ color: 'var(--text-2)' }} />
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                onClick={handleCropCancel}
                className="btn-ghost"
                style={{ padding: '0.5rem 1rem', borderRadius: 12 }}
              >
                Cancelar
              </button>
              <button
                onClick={handleCropSave}
                disabled={cropLoading}
                className="btn-brand"
                style={{ padding: '0.5rem 1.25rem', borderRadius: 12 }}
              >
                {cropLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Salvar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
