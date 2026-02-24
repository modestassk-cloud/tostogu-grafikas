const nodemailer = require('nodemailer');

function parseBoolean(value, fallback = false) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function createEmailNotifierFromEnv() {
  const enabled = parseBoolean(process.env.EMAIL_NOTIFICATIONS_ENABLED || 'true', true);
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const from = String(process.env.SMTP_FROM || user).trim();
  const to = String(
    process.env.MANAGER_NOTIFICATION_EMAIL || process.env.NOTIFICATION_EMAIL || 'modestas@eigida.lt',
  ).trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBoolean(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false'));

  const canSend = enabled && host && user && pass && from && to;
  let warned = false;
  const transporter = canSend
    ? nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      })
    : null;

  async function sendMail({ subject, text }) {
    if (!transporter) {
      if (!warned) {
        warned = true;
        console.warn(
          'Email pranešimai neaktyvūs: trūksta SMTP konfigūracijos (SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM).',
        );
      }
      return { sent: false };
    }

    await transporter.sendMail({
      from,
      to,
      subject,
      text,
    });

    return { sent: true };
  }

  return {
    enabled: canSend,
    targetEmail: to || null,
    sendMail,
  };
}

module.exports = {
  createEmailNotifierFromEnv,
};
