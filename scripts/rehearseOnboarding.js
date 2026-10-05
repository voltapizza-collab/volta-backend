import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Dedicated, fresh local database only. Never load production connection defaults.
const url = new URL(process.env.ONBOARDING_REHEARSAL_DATABASE_URL || 'invalid:');
assert.equal(url.protocol, 'mysql:');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.match(url.pathname, /^\/onboarding_rehearsal_[a-z0-9_]+$/);
assert.equal(url.port, '33317');
process.env.DATABASE_URL = url.href;
for (const key of ['SMTP_USER','SMTP_PASS','GMAIL_USER','GMAIL_APP_PASSWORD','GOOGLE_GEOCODING_KEY','GOOGLE_MAPS_API_KEY','REACT_APP_GOOGLE_KEY']) process.env[key] = '';
process.env.STRIPE_SECRET_KEY = 'sk_test_rehearsal_not_a_real_key';
process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET = 'whsec_local_rehearsal';
process.env.PUBLIC_FRONTEND_URL = 'http://127.0.0.1:4185';
process.env.VOLTA_ADMIN_USERNAME = 'onboarding-rehearsal';
const { hashWebPassword } = await import('../services/webSessions.js');
const adminPassword = crypto.randomBytes(24).toString('hex');
process.env.VOLTA_ADMIN_PASSWORD_HASH = hashWebPassword(adminPassword);
const { default: prisma } = await import('../services/prisma.js');
const { default: express } = await import('express');
const { default: onboardingRoutes } = await import('../routes/onboarding.js');
const { default: webAuthRoutes } = await import('../routes/webAuth.js');
const { default: partnerRoutes } = await import('../routes/partners.js');
const { webAccess } = await import('../services/webAccess.js');
const { constructStripeWebhookEvent } = await import('../services/stripe.js');
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../output/onboarding-step5');
fs.mkdirSync(output, { recursive: true });
assert.equal(await prisma.onboardingRequest.count(), 0, 'Use a fresh database; rehearsal never resets existing data.');
const emails = [], sessions = new Map(), cases = [];
let failWelcome = false;
const stripeDeps = {
  isStripeCheckoutConfigured: () => true, constructStripeWebhookEvent,
  createOnboardingCheckout: async ({ request, offer, payment }) => {
    if (!sessions.has(payment.id)) sessions.set(payment.id, { id: payment.id, url: 'https://checkout.stripe.com/local-simulation',
      amount_total: offer.totalCents, currency: 'eur', status: 'open', payment_status: 'unpaid', payment_intent: `pi_${payment.id}`,
      metadata: { purpose: 'onboarding_initial', requestId: String(request.id), offerHash: offer.hash, paymentId: payment.id } });
    return sessions.get(payment.id);
  },
  retrieveCheckoutSession: async id => structuredClone(sessions.get(id)),
  retrieveOnboardingIntent: async id => {
    const s = [...sessions.values()].find(s => s.payment_intent === id); assert.ok(s);
    return { status: 'succeeded', amount_received: s.amount_total, currency: 'eur', metadata: s.metadata,
      latest_charge: { created: Math.floor(Date.now() / 1000), amount_refunded: s.refunded ? s.amount_total : 0 } };
  },
  expireOnboardingSession: async id => { sessions.get(id).status = 'expired'; },
  refundOnboardingPayment: async ({ intentId }) => { const s = [...sessions.values()].find(s => s.payment_intent === intentId); s.refunded = true; return { id: `re_${s.id}`, status: 'succeeded' }; },
  retrieveOnboardingRefund: async () => ({ status: 'succeeded' }),
};
const app = express();
app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
app.use('/api/auth', webAuthRoutes(prisma));
app.use(webAccess(prisma));
app.use('/api/partners', partnerRoutes);
app.use('/api/onboarding', onboardingRoutes(prisma, { stripeDeps, sendEmail: async mail => {
  if (failWelcome && mail.subject.startsWith('Bienvenido')) throw new Error('simulated_email_failure');
  emails.push(mail); return { ok: true };
} }));
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let adminToken;
const api = async (method, route, body, admin = false, expected = 200) => {
  const response = await fetch(base + '/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${typeof admin === 'string' ? admin : adminToken}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`); return result;
};
const fields = { partnerType: 'AUTONOMO', legalName: 'Prueba local', taxId: 'TEST', legalRepresentative: 'Prueba', representativeRole: 'Titular',
  businessAddress: 'Calle de prueba 1', city: 'Madrid', postalCode: '28001', country: 'España', businessPhone: '600000000',
  accountHolder: 'Prueba', iban: 'ES0012341234123412341234', acceptedTerms: true, acceptedCompliance: true, commercialAcknowledged: true };
const offerInput = { approved: true, posTotalCents: 28001, rentCents: 1100, depositCents: 0, smsCents: 1000, smsCredits: 100, signatureDays: 7, refundDays: 14,
  generalTerms: 'DOCUMENTO DE PRUEBA LOCAL. No es una oferta comercial válida. '.repeat(8),
  equipmentTerms: 'Prueba de configuración y soporte del equipo para el ensayo local.',
  settlementTerms: 'Prueba de liquidaciones sobre fondos disponibles, sin anticipos de Volta.',
  cancellationTerms: 'Condiciones ficticias para comprobar el campo, sin efectos comerciales.',
  supplyTerms: 'En este ensayo un retraso permite nueva fecha aceptada o cancelación con devolución.',
  stockStatus: 'IN_STOCK', supplyReference: 'LOCAL-TEST', deliveryExpected: '2099-01-01', deliveryLatest: '2099-01-10' };
try {
  adminToken = (await api('POST', '/auth/admin-login', { username: process.env.VOLTA_ADMIN_USERNAME, password: adminPassword })).sessionToken;
  await api('GET', '/onboarding/pricing', null, false, 401);
  await api('POST', '/onboarding/pricing', { posTotalCents: 29999, revision: 0 }, true);
  for (const [index, mode] of ['PURCHASE', 'INSTALLMENTS', 'RENT_QUOTE'].entries()) {
    const emailStart = emails.length;
    const business = `Prueba local ${index + 1}`, email = `local${index + 1}@example.invalid`;
    let row = (await api('POST', '/onboarding/requests', { name: 'Responsable de prueba', business, email }, false, 201)).request;
    assert.equal(row.commercialClosurePending, true);
    await api('POST', `/onboarding/requests/${row.id}/contract/send`, {}, true, 409);
    assert.equal(row.commercialCatalog.posTotalCents, 29999);
    assert.equal(emails.length, emailStart + 1); assert.match(emails.at(-1).text, /stock/);
    // Document ingestion has its own upload integration; seed synthetic verified placeholders only.
    await prisma.onboardingRequest.update({ where: { id: row.id }, data: { formalData: { ...row.formalData, supportingDocuments: [{ type: 'IDENTITY' }, { type: 'FISCAL' }] } } });
    row = (await api('POST', `/onboarding/form/${row.token}`, { ...fields, commercialName: business, businessEmail: email, posChoice: mode, posInstallments: 6, commercialVersion: row.commercialCatalog.version })).request;
    assert.equal(emails.length, emailStart + 1, 'No fourth review email');
    await api('POST', `/onboarding/requests/${row.id}/offer`, { ...offerInput, stockStatus: 'WAITING' }, true, 409);
    row = (await api('POST', `/onboarding/requests/${row.id}/offer`, offerInput, true)).request;
    const hash = row.closure.offer.hash, exactText = row.closure.offer.documentText;
    await api('POST', `/onboarding/requests/${row.id}/contract/send`, {}, true);
    assert.equal(emails.length, emailStart + 2); assert.match(emails.at(-1).html, /fecha límite/);
    await api('POST', `/onboarding/form/${row.token}/sign-contract`, { offerHash: hash, acceptedContract: true }, false, 409);
    await api('POST', `/onboarding/form/${row.token}/closure/consent`, { offerHash: hash, accepted: true });
    if (mode === 'PURCHASE') await api('POST', `/onboarding/requests/${row.id}/cash-payment`, { offerHash: hash, receipt: 'LOCAL-CASH', confirmReceived: true }, true);
    else {
      await Promise.all([1, 2].map(() => api('POST', `/onboarding/form/${row.token}/closure/checkout`, { offerHash: hash })));
      const active = [...sessions.values()].filter(s => s.metadata.requestId === String(row.id)); assert.equal(active.length, 1);
      await api('POST', `/onboarding/form/${row.token}/sign-contract`, { offerHash: hash, acceptedContract: true }, false, 409);
      Object.assign(active[0], { status: 'complete', payment_status: 'paid' });
      const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: active[0] } });
      const timestamp = Math.floor(Date.now() / 1000), signature = crypto.createHmac('sha256', process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex');
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = await fetch(base + '/api/onboarding/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` }, body: payload });
        assert.equal(response.status, 200, await response.text());
      }
    }
    failWelcome = mode === 'RENT_QUOTE';
    const results = await Promise.all([1, 2].map(() => api('POST', `/onboarding/form/${row.token}/sign-contract`, { offerHash: hash, acceptedContract: true })));
    row = (await api('GET', `/onboarding/form/${row.token}`)).request;
    assert.equal(row.status, 'ACTIVATED'); assert.equal(row.formalData.signedContract.contentText, exactText);
    assert.equal(await prisma.smsCreditLedger.count({ where: { partnerId: row.formalData.activation.partnerId } }), 1);
    assert.equal((await prisma.partner.findUnique({ where: { id: row.formalData.activation.partnerId } })).smsCredits, 100);
    const store = await prisma.store.findUnique({ where: { id: row.formalData.activation.storeId } }); assert.equal(store.acceptingOrders, false);
    if (failWelcome) {
      assert.equal(row.formalData.credentialsNotification.emailStatus, 'FAILED'); failWelcome = false;
      row = (await api('POST', `/onboarding/requests/${row.id}/credentials/send`, {}, true)).request;
      assert.equal(row.formalData.credentialsNotification.emailStatus, 'SENT');
      assert.equal(await prisma.smsCreditLedger.count({ where: { partnerId: row.formalData.activation.partnerId } }), 1);
      assert.doesNotMatch(emails.at(-1).text, /undefined/);
    }
    assert.equal(emails.length, emailStart + 3); assert.match(emails.at(-1).text, /recepción de pedidos sigue cerrada/);
    const invitation = emails.at(-1).text.match(/\/backoffice\/[^?\s]+\?reset=([a-f0-9]{64})/); assert.ok(invitation);
    const password = 'Local test passphrase for onboarding only', partnerSlug = row.formalData.activation.partnerSlug;
    await api('POST', '/partners/backoffice-password/reset', { token: invitation[1], password, partnerSlug });
    await api('POST', '/partners/backoffice-password/reset', { token: invitation[1], password, partnerSlug }, false, 400);
    const session = await api('POST', '/partners/backoffice-login', { username: partnerSlug, password, partnerSlug });
    assert.equal(session.partnerId, row.formalData.activation.partnerId);
    await api('GET', `/auth/session?partnerSlug=${partnerSlug}&role=backoffice`, null, session.sessionToken);
    await api('GET', '/auth/session?partnerSlug=another-business&role=backoffice', null, session.sessionToken, 403);
    await api('POST', '/onboarding/pricing', { posTotalCents: 1, revision: 1 }, session.sessionToken, 403);
    for (const response of results) assert.equal(response.activation.posPin, undefined);
    cases.push({ mode, passed: true, requestId: row.id, partnerId: row.formalData.activation.partnerId, storeId: store.id,
      oneActivationAndSmsCredit: true, exactContract: true, threeEmails: true, receptionClosed: true, businessAccessVerified: true, failedWelcomeRecovered: mode === 'RENT_QUOTE' });
  }
  assert.equal(await prisma.partner.count(), 3); assert.equal(await prisma.store.count(), 3);
  // Genuine row-lock race for the singleton price; precisely one edit wins.
  const changes = await Promise.all([31000, 32000].map(posTotalCents => fetch(base + '/api/onboarding/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ posTotalCents, revision: 1 }) })));
  assert.deepEqual(changes.map(r => r.status).sort(), [200, 409]);
  // Paid but unsigned cancellation: no activation or SMS, including retries.
  let cancelled = (await api('POST', '/onboarding/requests', { name: 'Prueba', business: 'Cancelación local', email: 'cancel@example.invalid' }, false, 201)).request;
  await prisma.onboardingRequest.update({ where: { id: cancelled.id }, data: { formalData: { ...cancelled.formalData, supportingDocuments: [{ type: 'IDENTITY' }, { type: 'FISCAL' }] } } });
  await api('POST', `/onboarding/form/${cancelled.token}`, { ...fields, commercialName: 'Cancelación local', businessEmail: 'cancel@example.invalid', posChoice: 'PURCHASE', commercialVersion: cancelled.commercialCatalog.version });
  cancelled = (await api('POST', `/onboarding/requests/${cancelled.id}/offer`, offerInput, true)).request;
  const cancelHash = cancelled.closure.offer.hash;
  await api('POST', `/onboarding/form/${cancelled.token}/closure/consent`, { offerHash: cancelHash, accepted: true });
  await api('POST', `/onboarding/form/${cancelled.token}/closure/checkout`, { offerHash: cancelHash });
  const cancelSession = [...sessions.values()].find(s => s.metadata.requestId === String(cancelled.id));
  Object.assign(cancelSession, { status: 'complete', payment_status: 'paid' });
  await api('POST', `/onboarding/form/${cancelled.token}/closure/cancel`, { offerHash: cancelHash });
  for (let repeat = 0; repeat < 2; repeat++) await api('POST', `/onboarding/requests/${cancelled.id}/resolve-cancellation`, { offerHash: cancelHash, confirmRefund: true }, true);
  await api('POST', `/onboarding/form/${cancelled.token}/sign-contract`, { offerHash: cancelHash, acceptedContract: true }, false, 409);
  assert.equal((await api('GET', `/onboarding/form/${cancelled.token}`)).request.closure.status, 'REFUNDED');
  assert.equal(await prisma.partner.count(), 3); assert.equal(await prisma.smsCreditLedger.count(), 3);
  for (let i = 0; i < emails.length; i++) fs.writeFileSync(path.join(output, `email-${i + 1}.html`), emails[i].html);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), database: url.pathname.slice(1), cases,
    defaultPriceRace: true, cancelledPaymentRefundedWithoutActivation: true, realMysql: true, stripe: 'Simulated, with real signed webhook handler', smtp: 'Captured locally; no external mail',
    limitations: ['No external Stripe or SMTP delivery', 'Document upload seeded with synthetic placeholders', 'No physical POS or printer tested', 'No production deployment'] }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: cases.length, emails: emails.length, realMysql: true, output }));
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await prisma.$disconnect();
}
