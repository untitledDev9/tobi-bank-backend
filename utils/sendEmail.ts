import nodemailer from 'nodemailer';

interface EmailOptions {
  email: string;
  subject: string;
  /** Plain-text body, always sent alongside `html` as multipart */
  message: string;
  html?: string;
}

const sendEmail = async (options: EmailOptions): Promise<void> => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });

  const message = {
    // Gmail only sends as the account it logs in with, so keep From on that address
    from: process.env.EMAIL_FROM || `"RecordVault Financial" <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
    headers: { 'Auto-Submitted': 'auto-generated' },
  };

  await transporter.sendMail(message);
};

export default sendEmail;
