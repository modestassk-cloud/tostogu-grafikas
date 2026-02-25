require('dotenv').config();

const { createEmailNotifierFromEnv } = require('./notifications');

async function main() {
  const subject = process.env.TEST_EMAIL_SUBJECT || 'TESTAS: Atostogu sistemos el. pastas';
  const text = process.env.TEST_EMAIL_BODY || 'Jei gavai sia zinute, email siuntimas veikia.';

  const notifier = createEmailNotifierFromEnv();
  const result = await notifier.sendMail({ subject, text });
  console.log(`mail_sent=${Boolean(result && result.sent)}`);
}

main().catch((error) => {
  console.error('mail_error=', error && error.message ? error.message : error);
  process.exit(1);
});
