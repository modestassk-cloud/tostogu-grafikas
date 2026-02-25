const nodemailer = require('nodemailer');

function parseBoolean(value, fallback = false) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseProvider(rawValue) {
  const value = String(rawValue || 'auto')
    .trim()
    .toLowerCase();
  if (value === 'resend' || value === 'smtp' || value === 'auto') {
    return value;
  }
  return 'auto';
}

function trimEnv(name) {
  return String(process.env[name] || '').trim();
}

function isResendConfigured() {
  return Boolean(trimEnv('RESEND_API_KEY') && trimEnv('RESEND_FROM'));
}

function createResendSender({ to }) {
  const apiKey = trimEnv('RESEND_API_KEY');
  const from = trimEnv('RESEND_FROM');
  const apiBase = trimEnv('RESEND_API_BASE') || 'https://api.resend.com';
  const endpoint = `${apiBase.replace(/\/$/, '')}/emails`;

  if (!apiKey || !from) {
    return null;
  }

  return {
    provider: 'resend',
    async sendMail({ subject, text }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to,
            subject,
            text,
          }),
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = payload?.message || payload?.error || `HTTP ${response.status}`;
          throw new Error(`Resend API klaida: ${message}`);
        }

        return { sent: true, provider: 'resend', messageId: payload?.id || null };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function isSmtpConfigured({ host, user, pass, from, to }) {
  return Boolean(host && user && pass && from && to);
}

function createSmtpSender({ host, port, secure, user, pass, from, to, allowInternalNetworkInterfaces }) {
  if (!isSmtpConfigured({ host, user, pass, from, to })) {
    return null;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // Helps SMTP DNS resolution inside containerized runtimes where only internal IPv4 interfaces are visible.
    allowInternalNetworkInterfaces,
  });

  return {
    provider: 'smtp',
    async sendMail({ subject, text }) {
      await transporter.sendMail({
        from,
        to,
        subject,
        text,
      });

      return { sent: true, provider: 'smtp' };
    },
  };
}

function createEmailNotifierFromEnv() {
  const enabled = parseBoolean(process.env.EMAIL_NOTIFICATIONS_ENABLED || 'true', true);
  const provider = parseProvider(process.env.EMAIL_PROVIDER || 'auto');
  const host = trimEnv('SMTP_HOST');
  const user = trimEnv('SMTP_USER');
  const pass = trimEnv('SMTP_PASS');
  const from = trimEnv('SMTP_FROM') || user;
  const to = String(
    process.env.MANAGER_NOTIFICATION_EMAIL || process.env.NOTIFICATION_EMAIL || 'modestas@eigida.lt',
  ).trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBoolean(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false'));
  const allowInternalNetworkInterfaces = parseBoolean(
    process.env.SMTP_ALLOW_INTERNAL_INTERFACES || 'true',
    true,
  );

  const canUseResend = isResendConfigured();
  const canUseSmtp = isSmtpConfigured({ host, user, pass, from, to });

  let sender = null;
  if (enabled) {
    if ((provider === 'auto' || provider === 'resend') && canUseResend) {
      sender = createResendSender({ to });
    }

    if (!sender && (provider === 'auto' || provider === 'smtp') && canUseSmtp) {
      sender = createSmtpSender({
        host,
        port,
        secure,
        user,
        pass,
        from,
        to,
        allowInternalNetworkInterfaces,
      });
    }
  }

  const canSend = Boolean(enabled && sender && to);
  let warned = false;

  async function sendMail({ subject, text }) {
    if (!sender) {
      if (!warned) {
        warned = true;
        const hints = [
          'Resend: RESEND_API_KEY + RESEND_FROM',
          'SMTP: SMTP_HOST + SMTP_USER + SMTP_PASS + SMTP_FROM',
        ];
        console.warn(`Email pranešimai neaktyvūs: trūksta konfigūracijos (${hints.join(' | ')}).`);
      }
      return { sent: false };
    }

    return sender.sendMail({ subject, text });
  }

  return {
    enabled: canSend,
    provider: sender?.provider || null,
    targetEmail: to || null,
    sendMail,
  };
}

module.exports = {
  createEmailNotifierFromEnv,
};
