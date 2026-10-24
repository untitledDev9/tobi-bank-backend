// Branded transactional email templates. Each builder returns the plain-text body
// (`message`) and the HTML body (`html`) so mail is always sent as multipart.
// Layout is table-based with inline styles because email clients ignore most CSS.

const BRAND = 'RecordVault Financial';

const COLOR = {
  dark: '#032B20',
  primary: '#0D7A5C',
  primaryDeep: '#0A6149',
  tint: '#EAF7F1',
  tintBorder: '#ABDEC9',
  text: '#1B2823',
  muted: '#5E6E67',
  line: '#E6ECE9',
  page: '#F1F5F3',
  card: '#FFFFFF',
  warnBg: '#FFF8E6',
  warnBorder: '#F2DDA0',
  warnText: '#6B5310',
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";

export const escapeHtml = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface Layout {
  preheader: string;
  heading: string;
  bodyHtml: string;
}

const layout = ({ preheader, heading, bodyHtml }: Layout): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.page};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
        <tr>
          <td style="background:${COLOR.dark};border-radius:16px 16px 0 0;padding:24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" valign="middle" width="38" height="38" style="width:38px;height:38px;background:${COLOR.primary};border-radius:10px;font-family:${FONT};font-size:14px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">RV</td>
                <td valign="middle" style="padding-left:12px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#FFFFFF;">RecordVault<span style="font-weight:400;color:#79C7A8;letter-spacing:3px;"> Financial</span></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:${COLOR.card};border-left:1px solid ${COLOR.line};border-right:1px solid ${COLOR.line};padding:36px 32px 32px;font-family:${FONT};color:${COLOR.text};">
            <h1 style="margin:0 0 14px;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${COLOR.dark};">${escapeHtml(heading)}</h1>
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:${COLOR.card};border:1px solid ${COLOR.line};border-top:0;border-radius:0 0 16px 16px;padding:0 32px 28px;font-family:${FONT};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid ${COLOR.line};padding-top:20px;font-size:12px;line-height:1.6;color:${COLOR.muted};">
                You are receiving this email because of activity on your ${BRAND} account.<br>
                &copy; ${new Date().getFullYear()} ${BRAND}. All rights reserved.
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

const paragraph = (html: string): string =>
  `<p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:${COLOR.text};">${html}</p>`;

interface OtpEmail {
  heading: string;
  intro: string;
  code: string;
  expiresInMinutes: number;
  /** Show the "you can ignore this" line (leave on unless the user is mid-login) */
  ignoreNote?: boolean;
}

export const otpEmail = ({ heading, intro, code, expiresInMinutes, ignoreNote = true }: OtpEmail) => {
  const ignoreText = 'If you did not request this, you can safely ignore this email. Your account stays protected.';

  const bodyHtml = `
${paragraph(escapeHtml(intro))}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr>
    <td align="center" style="background:${COLOR.tint};border:1px solid ${COLOR.tintBorder};border-radius:14px;padding:24px 16px;">
      <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${COLOR.primaryDeep};">Your verification code</div>
      <div style="font-family:${MONO};font-size:38px;line-height:1.2;font-weight:700;letter-spacing:10px;padding:10px 0 0 10px;color:${COLOR.dark};">${escapeHtml(code)}</div>
      <div style="font-family:${FONT};font-size:13px;padding-top:10px;color:${COLOR.muted};">Expires in ${expiresInMinutes} minutes</div>
    </td>
  </tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${ignoreNote ? '20' : '0'}px;">
  <tr>
    <td style="background:${COLOR.warnBg};border:1px solid ${COLOR.warnBorder};border-radius:10px;padding:12px 14px;font-family:${FONT};font-size:13px;line-height:1.55;color:${COLOR.warnText};">
      <strong>Keep this code private.</strong> ${BRAND} will never ask you to share it, by email, phone or chat.
    </td>
  </tr>
</table>
${ignoreNote ? `<p style="margin:0;font-size:13px;line-height:1.6;color:${COLOR.muted};">${ignoreText}</p>` : ''}`;

  const message = [
    heading,
    '',
    intro,
    '',
    `Your verification code: ${code}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    '',
    `Keep this code private. ${BRAND} will never ask you to share it.`,
    ...(ignoreNote ? ['', ignoreText] : []),
    '',
    `- ${BRAND}`,
  ].join('\n');

  return {
    message,
    html: layout({
      preheader: `Your code is ${code}. It expires in ${expiresInMinutes} minutes.`,
      heading,
      bodyHtml,
    }),
  };
};

interface NoticeEmail {
  heading: string;
  greeting?: string;
  intro: string;
  /** Big figure shown above the details, e.g. the amount received */
  highlight?: { label: string; value: string };
  rows?: [label: string, value: string][];
  outro?: string;
}

export const noticeEmail = ({ heading, greeting, intro, highlight, rows = [], outro }: NoticeEmail) => {
  const highlightHtml = highlight
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr>
    <td align="center" style="background:${COLOR.tint};border:1px solid ${COLOR.tintBorder};border-radius:14px;padding:22px 16px;">
      <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${COLOR.primaryDeep};">${escapeHtml(highlight.label)}</div>
      <div style="font-family:${FONT};font-size:34px;line-height:1.2;font-weight:700;padding-top:8px;color:${COLOR.dark};">${escapeHtml(highlight.value)}</div>
    </td>
  </tr>
</table>`
    : '';

  const rowsHtml = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${COLOR.line};">
${rows
  .map(
    ([label, value]) => `  <tr>
    <td style="padding:12px 0;border-bottom:1px solid ${COLOR.line};font-family:${FONT};font-size:13px;color:${COLOR.muted};">${escapeHtml(label)}</td>
    <td align="right" style="padding:12px 0 12px 16px;border-bottom:1px solid ${COLOR.line};font-family:${FONT};font-size:14px;font-weight:600;color:${COLOR.text};word-break:break-word;">${escapeHtml(value)}</td>
  </tr>`
  )
  .join('\n')}
</table>`
    : '';

  const bodyHtml = `
${greeting ? paragraph(escapeHtml(greeting)) : ''}
${paragraph(escapeHtml(intro))}
${highlightHtml}
${rowsHtml}
${outro ? `<p style="margin:0;font-size:13px;line-height:1.6;color:${COLOR.muted};">${escapeHtml(outro)}</p>` : ''}`;

  const message = [
    ...(greeting ? [greeting, ''] : []),
    intro,
    '',
    ...(highlight ? [`${highlight.label}: ${highlight.value}`, ''] : []),
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(outro ? ['', outro] : []),
    '',
    `- ${BRAND}`,
  ].join('\n');

  return {
    message,
    html: layout({ preheader: intro, heading, bodyHtml }),
  };
};
