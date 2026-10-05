import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read configuration locally; never print secrets or contact any service.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = {};
for (const line of (fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '').split(/\r?\n/)) {
  const match = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (match) config[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
}
Object.assign(config, process.env);
const present = key => Boolean(config[key]?.trim());
const report = {
  scope: 'Local configuration only; no remote environment or connectivity verified',
  adminUsername: present('VOLTA_ADMIN_USERNAME'), adminPasswordHash: present('VOLTA_ADMIN_PASSWORD_HASH'),
  frontendUrl: Boolean(config.PUBLIC_FRONTEND_URL || config.FRONTEND_URL),
  stripeMode: /^sk_test_|^rk_test_/.test(config.STRIPE_SECRET_KEY || '') ? 'TEST' : /^sk_live_|^rk_live_/.test(config.STRIPE_SECRET_KEY || '') ? 'LIVE' : 'MISSING_OR_UNKNOWN',
  onboardingWebhookSecret: present('STRIPE_ONBOARDING_WEBHOOK_SECRET'),
  emailCredentials: Boolean((config.SMTP_USER || config.GMAIL_USER) && (config.SMTP_PASS || config.GMAIL_APP_PASSWORD)),
  databaseConfigured: present('DATABASE_URL'),
  signingKeyConfigured: present('WEB_ACTION_SIGNING_KEY'),
  requiredManualChecks: ['Remote migrations and environment', 'Stripe test checkout and signed webhook delivery', 'SMTP delivery to authorized test inbox', 'Real POS receipt and print'],
};
console.log(JSON.stringify(report, null, 2));
