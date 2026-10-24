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

const sendEmail = async (options: EmailOptions): Promise<void> => {
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
