import nodemailer, { Transporter } from 'nodemailer';

interface EmailOptions {
  email: string;
  subject: string;
  /** Plain-text body, always sent alongside `html` as multipart */
  message: string;
  html?: string;
}

// Built on first send, not at import: server.ts imports the controllers before dotenv.config()
// runs, so the credentials aren't in process.env yet. Pooled so every email reuses an open SMTP
// connection instead of paying a new TLS + auth handshake with Gmail.
let transporter: Transporter | undefined;

const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      pool: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
};

// Resend over HTTPS: hosts like Render block outbound SMTP, so this is the production path.
// `from` must be on a domain verified in the Resend dashboard.
const sendWithResend = async (options: EmailOptions): Promise<void> => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [options.email],
      subject: options.subject,
      text: options.message,
      html: options.html,
      headers: { 'Auto-Submitted': 'auto-generated' },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${await res.text()}`);
  }
};

const sendEmail = async (options: EmailOptions): Promise<void> => {
  if (process.env.RESEND_API_KEY) {
    await sendWithResend(options);
    return;
  }

  // Fallback (local dev): Gmail SMTP
  const message = {
    // Gmail only sends as the account it logs in with, so keep From on that address
    from: process.env.EMAIL_FROM || `"RecordVault Financial" <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
    headers: { 'Auto-Submitted': 'auto-generated' },
  };

  await getTransporter().sendMail(message);
};

export default sendEmail;
