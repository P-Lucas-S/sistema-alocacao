import nodemailer from 'nodemailer';

let _transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

interface WelcomeEmailData {
  name: string;
  email: string;
  password: string;
  role: string;
  position?: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin:       'Administrador',
  gestor:      'Gestor',
  coordenacao: 'Coordenação',
};

function buildWelcomeHtml(data: WelcomeEmailData): string {
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';
  const roleLabel = ROLE_LABELS[data.role] || data.role;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1d2e;border-radius:16px;border:1px solid #2a2d3e;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Sistema de Alocação</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Gestão de Equipes</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <h2 style="margin:0 0 8px;color:#f1f5f9;font-size:20px;font-weight:600;">Bem-vindo(a), ${data.name}!</h2>
          <p style="margin:0 0 28px;color:#94a3b8;font-size:14px;line-height:1.6;">
            Sua conta foi criada. Utilize os dados abaixo para o primeiro acesso.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;border-radius:12px;border:1px solid #2a2d3e;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:6px 0;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Email</td></tr>
                <tr><td style="padding:0 0 16px;color:#f1f5f9;font-size:15px;">${data.email}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Senha temporária</td></tr>
                <tr><td style="padding:0 0 16px;font-family:'Courier New',monospace;color:#f1f5f9;font-size:16px;font-weight:700;letter-spacing:2px;background:#161929;border-radius:8px;padding:12px 16px;border:1px dashed #3b82f6;">${data.password}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Nível de acesso</td></tr>
                <tr><td style="padding:0;color:#f1f5f9;font-size:15px;">${roleLabel}${data.position ? ` · ${data.position}` : ''}</td></tr>
              </table>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:4px 0 8px;">
              <a href="${APP_URL}" target="_blank"
                 style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:10px;">
                Acessar o Sistema
              </a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 40px 28px;border-top:1px solid #2a2d3e;text-align:center;">
          <p style="margin:0;color:#475569;font-size:12px;line-height:1.5;">
            Recomendamos alterar sua senha após o primeiro acesso.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<{ success: boolean; error?: string }> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    console.warn('⚠️  GMAIL_USER ou GMAIL_APP_PASSWORD não configurados. Email não enviado.');
    return { success: false, error: 'Gmail credentials not configured' };
  }

  try {
    _transporter = null;
    const info = await getTransporter().sendMail({
      from: `Sistema de Alocação <${gmailUser}>`,
      to: data.email,
      subject: 'Sua conta foi criada',
      html: buildWelcomeHtml(data),
    });
    console.log(`✅ Welcome email sent to ${data.email}`, info.response);
    return { success: true };
  } catch (err: any) {
    console.error('❌ Email send failed:', err.message);
    return { success: false, error: err.message || 'Unknown email error' };
  }
}

export async function sendPasswordResetEmail(email: string, resetCode: string): Promise<{ success: boolean; error?: string }> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    console.warn('⚠️ GMAIL_USER ou GMAIL_APP_PASSWORD não configurados. Email de reset não enviado.');
    return { success: false, error: 'Gmail credentials not configured' };
  }

  try {
    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#f4f4f5;color:#18181b;">
  <div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:10px;text-align:center;box-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1);">
    <h2 style="color:#4f46e5;margin-top:0;">Recuperação de Senha</h2>
    <p>Você solicitou a redefinição de senha para a sua conta.</p>
    <p style="margin:25px 0;">Seu código de recuperação é:</p>
    <div style="font-size:32px;font-weight:bold;letter-spacing:5px;color:#4f46e5;background:#eef2ff;padding:15px;border-radius:8px;border:1px dashed #818cf8;">
      ${resetCode}
    </div>
    <p style="margin-top:25px;font-size:14px;color:#71717a;">Este código é válido por 30 minutos.<br>Se você não solicitou isso, ignore este email.</p>
  </div>
</body>
</html>`;

    await getTransporter().sendMail({
      from: `Sistema de Alocação <${gmailUser}>`,
      to: email,
      subject: 'Código de Recuperação de Senha',
      html,
    });
    console.log(`✅ Password reset email sent to ${email}`);
    return { success: true };
  } catch (err: any) {
    console.error('❌ Password reset email send failed:', err.message);
    return { success: false, error: err.message || 'Unknown email error' };
  }
}
