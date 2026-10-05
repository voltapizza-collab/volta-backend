import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import onboardingRoutes from '../routes/onboarding.js';
import { constructStripeWebhookEvent, createOnboardingCheckout } from '../services/stripe.js';
import { buildClosureOffer, closureView, createClosureService, verifyOffer } from '../services/onboardingClosure.js';
import { buildCommercialSelection, onboardingCommercialCatalog } from '../services/onboardingCommercial.js';
import { newOnboardingCatalog, updateOnboardingPricing } from '../services/onboardingPricing.js';
import closureRoutes from '../routes/onboardingClosure.js';
import { isPublicWebRoute } from '../services/webAccess.js';
import { normalizeOnboardingDefaults, offerDefaults } from '../services/onboardingDefaults.js';

const selection = mode => {
  const result = buildCommercialSelection({ posChoice: mode, posInstallments: 6, commercialAcknowledged: true, commercialVersion: onboardingCommercialCatalog().version }).selection;
  result.sms.initialRecharge = 'INCLUDED'; // Historical offer fixtures include a paid recharge.
  return result;
};
const request = (mode = 'PURCHASE') => ({ id: 1, token: 'test-only', status: 'IN_REVIEW', submittedAt: new Date(),
  formalData: { commercialSelection: selection(mode), legalName: 'Test', taxId: 'TEST', commercialName: 'Test store',
    legalRepresentative: 'Test', representativeRole: 'Owner', businessEmail: 'test@example.invalid',
    businessAddress: 'Test street', postalCode: '00000', city: 'Test', country: 'Spain', accountHolder: 'Test', iban: 'TEST' } });
const input = () => ({ approved: true, posTotalCents: 28001, rentCents: 1100, depositCents: 0,
  generalTerms: 'Condiciones generales de prueba sin efectos comerciales. '.repeat(8),
  equipmentTerms: 'Condiciones del equipo para pruebas controladas, sin clientes reales.',
  settlementTerms: 'Calendario de liquidaciones de prueba sobre fondos disponibles.',
  cancellationTerms: 'Condiciones de cancelación anticipada acordadas para esta prueba.',
  supplyTerms: 'Si no se cumple la fecha, nueva fecha aceptada o devolución del suministro no entregado.',
  stockStatus: 'IN_STOCK', supplyReference: 'stock-test', deliveryExpected: '2099-01-01', deliveryLatest: '2099-01-10',
  smsCents: 1000, smsCredits: 100, signatureDays: 7, refundDays: 14 });

function fixture(mode = 'PURCHASE') {
  let row = request(mode), price = null, queue = Promise.resolve();
  const sessions = new Map(); let creates = 0, refunds = 0;
  const db = { onboardingRequest: {
    findUnique: async () => structuredClone(row),
    update: async ({ data }) => { row = { ...row, ...structuredClone(data) }; return structuredClone(row); },
  }, onboardingPricing: {
    findUnique: async () => structuredClone(price),
    upsert: async ({ create }) => { price ||= structuredClone(create); return price; },
    updateMany: async ({ where, data }) => {
      if (where.revision !== price.revision) return { count: 0 };
      price = { ...price, ...data, revision: price.revision + 1 }; return { count: 1 };
    },
  }, $queryRawUnsafe: async () => [] };
  db.$transaction = fn => {
    const result = queue.then(async () => {
      const backup = structuredClone({ row, price });
      try { return await fn(db); } catch (error) { row = backup.row; price = backup.price; throw error; }
    });
    queue = result.catch(() => {}); return result;
  };
  const deps = {
    createOnboardingCheckout: async ({ offer, payment }) => {
      if (!sessions.has(payment.id)) { creates++; sessions.set(payment.id, { id: payment.id, url: 'https://checkout.stripe.com/test',
        metadata: { purpose: 'onboarding_initial', requestId: '1', offerHash: offer.hash, paymentId: payment.id },
        amount_total: offer.totalCents, currency: 'eur', status: 'open', payment_status: 'unpaid', payment_intent: 'pi_test' }); }
      return structuredClone(sessions.get(payment.id));
    },
    retrieveCheckoutSession: async id => structuredClone(sessions.get(id)),
    retrieveOnboardingIntent: async () => ({ status: 'succeeded', amount_received: row.formalData.closure.offer.totalCents,
      currency: 'eur', latest_charge: { created: Math.floor(Date.now() / 1000), amount_refunded: 0 } }),
    expireOnboardingSession: async id => { sessions.get(id).status = 'expired'; },
    refundOnboardingPayment: async () => { refunds++; return { id: 're_test', status: 'succeeded' }; },
    retrieveOnboardingRefund: async () => ({ id: 're_test', status: 'succeeded' }),
  };
  return { db, deps, service: createClosureService(db, deps), sessions, row: () => row,
    counts: () => ({ creates, refunds }), paid: () => { for (const s of sessions.values()) Object.assign(s, { status: 'complete', payment_status: 'paid' }); } };
}
async function offered(f, custom = {}) {
  await f.service.publish(1, { ...input(), ...custom }, { username: 'test-admin' });
  return f.row().formalData.closure.offer.hash;
}

test('variable sale price drives every installment, contract and first payment; renting has exactly 36 payments', () => {
  for (let count = 2; count <= 6; count++) {
    const row = request('INSTALLMENTS'); row.formalData.commercialSelection.pos.installmentCount = count;
    const offer = buildClosureOffer(row, input());
    assert.equal(offer.pos.payments.reduce((a, b) => a + b), 28001);
    assert.equal(offer.totalCents, offer.pos.payments[0] + 1000);
    assert.equal(offer.pos.priceChanged, true); assert.match(offer.documentText, /Compra: 280.01 EUR/); verifyOffer(offer);
  }
  const rent = buildClosureOffer(request('RENT_QUOTE'), input());
  assert.equal(rent.pos.payments.length, 36); assert.equal(rent.pos.totalCents, 39600);
  assert.equal(rent.totalCents, 2100); assert.equal(rent.pos.ownership, 'VOLTA');
  assert.match(rent.documentText, /sin precio residual ni mensualidad 37/);
  assert.match(rent.documentText, /entrega operativa/);
  rent.pos.payments[0] = 1; assert.throws(() => verifyOffer(rent), /offer_integrity_failed/);
});

test('optional SMS excludes charges even with stale package inputs; the contract freezes the unit tariff', () => {
  const row = request(); row.formalData.commercialSelection.sms.initialRecharge = 'SEPARATE';
  const without = buildClosureOffer(row, input());
  assert.deepEqual(without.lines.map(line => line.code), ['POS']);
  assert.equal(without.totalCents, 28001); assert.equal(without.sms.credits, 0);
  assert.equal(offerDefaults(row, { defaults: { smsCents: 1000 } }, '').smsCents, 0);
  assert.match(without.documentText, /cuyo uso es opcional/);
  assert.doesNotMatch(without.documentText, /0,075|133 partes/);
  assert.match(without.documentText, /tarifa vigente, que puede variar/);
  verifyOffer(without);
  row.formalData.commercialSelection.sms.initialRecharge = 'INCLUDED';
  const withSms = buildClosureOffer(row, { ...input(), smsCredits: 133 });
  assert.equal(withSms.totalCents, 29001); assert.equal(withSms.sms.unitPriceEur, '0.0750');
  assert.match(withSms.documentText, /133 partes por 10.00 EUR/);
  withSms.sms.unitPriceEur = '0.1'; assert.throws(() => verifyOffer(withSms), /offer_integrity_failed/);
  delete row.formalData.commercialSelection.sms.initialRecharge;
  assert.equal(buildClosureOffer(row, input()).totalCents, 29001); // Preserve pre-checkbox selections.
});

test('offer integrity survives MySQL JSON key reordering but detects changed amounts or payment order', () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])])) : value;
  const original = buildClosureOffer(request('INSTALLMENTS'), input());
  const persisted = JSON.parse(JSON.stringify(reorder(original))); verifyOffer(persisted);
  assert.equal(persisted.hash, original.hash);
  persisted.pos.payments.reverse(); assert.throws(() => verifyOffer(persisted), /offer_integrity_failed/);
});

test('invalid prices, unavailable stock, impossible dates and incomplete renting cannot become offers', () => {
  for (const price of [0, -1, 0.5, '28000', null, 1000001]) assert.throws(() => buildClosureOffer(request(), { ...input(), posTotalCents: price }), /invalid_pos_price/);
  for (const custom of [{ stockStatus: 'WAITING' }, { deliveryExpected: '2026-02-30' }, { deliveryLatest: '2000-01-01' }]) {
    assert.throws(() => buildClosureOffer(request(), { ...input(), ...custom }));
  }
  assert.throws(() => buildClosureOffer(request('RENT_QUOTE'), { ...input(), cancellationTerms: '' }), /offer_text_required/);
});

test('default tariff only changes future catalogs; stale administrative edits are rejected', async () => {
  const f = fixture(), previous = await newOnboardingCatalog(f.db);
  await updateOnboardingPricing(f.db, { posTotalCents: 31000, revision: 0 }, 'test-admin');
  const next = await newOnboardingCatalog(f.db);
  assert.equal(previous.posTotalCents, 25000); assert.equal(next.posTotalCents, 31000);
  assert.notEqual(previous.version, next.version);
  assert.equal(buildCommercialSelection({ posChoice: 'PURCHASE' }, { catalog: previous }).selection.pos.totalCents, 25000);
  await assert.rejects(updateOnboardingPricing(f.db, { posTotalCents: 1, revision: 1 }, 'x'), /invalid_pos_price/);
  await assert.rejects(updateOnboardingPricing(f.db, { posTotalCents: 29000, revision: 0 }, 'x'), /pricing_changed/);
});

test('shared settings calculate rentals and SMS while preserving existing catalog and contract snapshots', async () => {
  const f = fixture('RENT_QUOTE');
  const defaults = { ...input(), rentMode: 'PRICE_24', rentCents: null };
  await updateOnboardingPricing(f.db, { posTotalCents: 25000, revision: 0, defaults }, 'test-admin');
  const catalog = await newOnboardingCatalog(f.db);
  assert.equal(catalog.rental.monthlyCents, 1042); assert.equal(catalog.rental.totalCents, 37512);
  assert.equal(catalog.sms.packages[0].credits, 133); // Existing SMS service tariff, not an invented onboarding tariff.
  const row = request('RENT_QUOTE'); row.formalData.commercialCatalog = structuredClone(catalog);
  row.formalData.commercialSelection.sms.initialRecharge = 'SEPARATE';
  const prepared = offerDefaults(row, await f.db.onboardingPricing.findUnique(), input().generalTerms);
  const signedVersion = buildClosureOffer(row, { ...input(), ...prepared });
  await updateOnboardingPricing(f.db, { posTotalCents: 30000, revision: 1, defaults: { ...defaults, smsCents: 1500 } }, 'test-admin');
  const next = await newOnboardingCatalog(f.db);
  assert.equal(next.rental.monthlyCents, 1250); assert.equal(next.sms.packages[0].credits, 133);
  const original = offerDefaults(row, await f.db.onboardingPricing.findUnique(), input().generalTerms);
  assert.equal(original.rentCents, 1042); assert.equal(original.smsCredits, 0); assert.equal(original.posTotalCents, 25000);
  verifyOffer(signedVersion); assert.equal(signedVersion.pos.totalCents, 37512);
  await assert.rejects(updateOnboardingPricing(f.db, { posTotalCents: 30000, revision: 1, defaults }, 'test-admin'), /pricing_changed/);
});

test('incomplete defaults do not invent commercial terms and invalid defaults are rejected', () => {
  const settings = normalizeOnboardingDefaults({});
  assert.equal(settings.rentCents, null); assert.equal(settings.signatureDays, null); assert.equal(settings.settlementTerms, '');
  for (const input of [{ rentMode: 'invalid' }, { rentCents: -1 }, { depositCents: -1 }, { signatureDays: 61 }, { refundDays: 31 }, { equipmentTerms: 'short' }, { smsCents: 1.1 }]) {
    assert.throws(() => normalizeOnboardingDefaults(input), /invalid_onboarding_defaults/);
  }
});

test('consent is required; concurrent checkout retries reuse one payment; deferred payment cannot sign', async () => {
  const f = fixture(), hash = await offered(f);
  await assert.rejects(f.service.checkout(1, hash, 'https://example.invalid'), /prepayment_consent_required/);
  await f.service.consent(1, hash, {});
  await Promise.all([f.service.checkout(1, hash, 'https://example.invalid'), f.service.checkout(1, hash, 'https://example.invalid')]);
  assert.equal(f.counts().creates, 1);
  await assert.rejects(f.service.signingCheck(1, hash), /initial_payment_required/);
  for (const s of f.sessions.values()) s.status = 'complete'; // async processing: return from checkout is insufficient
  await assert.rejects(f.service.signingCheck(1, hash), /initial_payment_required/);
  f.paid(); await f.service.sync(1); await f.service.sync(1);
  assert.equal(closureView(f.row()).canSign, true);
  await f.service.signingCheck(1, hash);
  assert.deepEqual(await f.service.checkout(1, hash, 'https://example.invalid'), { paid: true });
  assert.equal(f.counts().creates, 1);
  await assert.rejects(f.service.publish(1, { ...input(), replacesOfferHash: hash }), /resolve_existing_payment_first/);
});

test('new offer resets consent and rejects old links; signed records cannot be replaced', async () => {
  const f = fixture(), hash = await offered(f); await f.service.consent(1, hash, {});
  await assert.rejects(f.service.publish(1, input()), /offer_changed/);
  await f.service.publish(1, { ...input(), posTotalCents: 30000, replacesOfferHash: hash });
  assert.equal(closureView(f.row()).consented, false);
  await assert.rejects(f.service.checkout(1, hash, ''), /offer_changed/);
  assert.equal(f.row().formalData.closure.history[0].offer.hash, hash);
  f.row().status = 'ACTIVATED';
  await assert.rejects(f.service.publish(1, input()), /onboarding_request_closed/);
});

test('cash requires prior consent and a receipt, is idempotent and supports documented cancellation', async () => {
  const f = fixture(), hash = await offered(f);
  await assert.rejects(f.service.cash(1, hash, 'receipt', {}), /prepayment_consent_required/);
  await f.service.consent(1, hash, {});
  await assert.rejects(f.service.cash(1, hash, '', {}), /offer_text_required/);
  await f.service.cash(1, hash, 'receipt-1', { username: 'admin' });
  const id = f.row().formalData.closure.payment.id;
  await f.service.cash(1, hash, 'receipt-1', {}); assert.equal(f.row().formalData.closure.payment.id, id);
  assert.equal(closureView(f.row()).canSign, true);
  await f.service.cancel(1, hash); assert.equal(closureView(f.row()).canSign, false);
  await f.service.refund(1, hash, 'refund-1', { username: 'admin' });
  assert.equal(f.row().formalData.closure.payment.status, 'REFUNDED');
});

test('cancel before settlement cannot be undone by late success; refunds are not duplicated', async () => {
  const f = fixture(), hash = await offered(f); await f.service.consent(1, hash, {});
  await f.service.checkout(1, hash, 'https://example.invalid'); await f.service.cancel(1, hash);
  f.paid(); await f.service.sync(1); assert.equal(closureView(f.row()).canSign, false);
  await f.service.refund(1, hash, '', {}); await f.service.refund(1, hash, '', {});
  assert.equal(f.counts().refunds, 1); assert.equal(f.row().formalData.closure.status, 'REFUNDED');
});

test('wrong amount, refunded/disputed payments and expired signing deadline never authorize signing', async () => {
  const f = fixture(), hash = await offered(f); await f.service.consent(1, hash, {}); await f.service.checkout(1, hash, ''); f.paid();
  const session = [...f.sessions.values()][0]; session.amount_total++;
  await assert.rejects(f.service.sync(1), /payment_mismatch/); session.amount_total--;
  await f.service.sync(1);
  f.row().formalData.closure.payment.paidAt = '2000-01-01T00:00:00Z';
  await assert.rejects(f.service.signingCheck(1, hash), /initial_payment_required/);
  assert.equal(closureView(f.row()).overdue, true);
  f.deps.retrieveOnboardingIntent = async () => ({ status: 'succeeded', amount_received: session.amount_total, currency: 'eur', latest_charge: { disputed: true } });
  await f.service.sync(1); assert.equal(f.row().formalData.closure.status, 'REVERSED');
});

test('HTTP rejects non-admin price/offer writes and invalid webhooks; token endpoints remain explicit', async t => {
  const f = fixture(); const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.get('test-role')) req.webSession = { role: req.get('test-role') }; next(); });
  app.use(closureRoutes(f.db, { mapRequest: row => ({ id: row.id, closure: closureView(row) }), draftContract: () => '', stripeDeps: f.deps }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (path, body, role = '') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'test-role': role }, body: JSON.stringify(body) });
  assert.equal((await post('/requests/1/offer', input(), 'backoffice')).status, 403);
  assert.equal((await post('/pricing', { posTotalCents: 1 })).status, 403);
  assert.equal((await post('/requests/1/offer', input(), 'global_admin')).status, 200);
  assert.equal((await post('/stripe/webhook', {})).status, 400);
  assert.equal(isPublicWebRoute('POST', '/onboarding/pricing'), false);
  assert.equal(isPublicWebRoute('POST', '/onboarding/form/token/closure/checkout'), true);
});

for (const smsRequested of [true, false]) test(`real signature activates once, SMS requested=${smsRequested}, preserving the exact offer`, async t => {
  for (const key of ['SMTP_USER','GMAIL_USER','SMTP_PASS','GMAIL_APP_PASSWORD','GOOGLE_GEOCODING_KEY','GOOGLE_MAPS_API_KEY','REACT_APP_GOOGLE_KEY']) {
    const previous = process.env[key]; delete process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const f = fixture(); f.row().formalData.commercialSelection.sms.initialRecharge = smsRequested ? 'INCLUDED' : 'SEPARATE';
  const hash = await offered(f); let partners = 0, stores = 0, ledgers = 0, credits = 0;
  f.db.$executeRawUnsafe = async () => 1;
  f.db.partner = { findUnique: async () => null,
    create: async ({ data }) => { partners++; return { id: 10, ...data }; },
    update: async ({ data }) => { credits += data.smsCredits.increment; return { id: 10, smsCredits: credits }; } };
  f.db.store = { findUnique: async () => null,
    create: async ({ data }) => { stores++; assert.equal(data.acceptingOrders, false); assert.equal(data.active, false); return { id: 20, ...data }; } };
  f.db.smsCreditLedger = { create: async ({ data }) => { ledgers++; assert.equal(data.quantity, 100); return { id: ledgers }; } };
  const app = express(); app.use(express.json()); app.use(onboardingRoutes(f.db));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const sign = () => fetch(`http://127.0.0.1:${server.address().port}/form/test-only/sign-contract`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptedContract: true, offerHash: hash }) });
  assert.equal((await sign()).status, 409); assert.equal(partners, 0);
  await f.service.consent(1, hash, {}); await f.service.cash(1, hash, 'test-cash-receipt', {});
  const originalDocument = f.row().formalData.closure.offer.documentText;
  const responses = await Promise.all([sign(), sign()]);
  for (const response of responses) { const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); }
  assert.deepEqual({ partners, stores, ledgers, credits }, { partners: 1, stores: 1, ledgers: smsRequested ? 1 : 0, credits: smsRequested ? 100 : 0 });
  assert.equal(f.row().formalData.closure.offer.totalCents, smsRequested ? 29001 : 28001);
  if (!smsRequested) assert.equal(f.row().formalData.closure.smsLedgerId, null);
  assert.equal(f.row().formalData.signedContract.contentText, originalDocument);
  assert.equal(f.row().formalData.signedContract.offerHash, hash);
  assert.equal(f.row().formalData.closure.status, 'SIGNED');
  assert.equal(f.row().formalData.activation.posPin, undefined);
});

test('signed duplicate Stripe webhook confirms once, while stale or modified signatures are rejected', async t => {
  const prior = process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET;
  process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET = 'whsec_test_only';
  t.after(() => { if (prior === undefined) delete process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET; else process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET = prior; });
  const f = fixture(), hash = await offered(f); await f.service.consent(1, hash, {}); await f.service.checkout(1, hash, ''); f.paid();
  f.deps.constructStripeWebhookEvent = constructStripeWebhookEvent;
  const app = express(); app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
  app.use(closureRoutes(f.db, { mapRequest: row => row, draftContract: () => '', stripeDeps: f.deps }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: [...f.sessions.values()][0] } });
  const send = (timestamp, bad = false) => {
    const digest = crypto.createHmac('sha256', 'whsec_test_only').update(`${timestamp}.${body}`).digest('hex');
    return fetch(`http://127.0.0.1:${server.address().port}/stripe/webhook`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${bad ? 'bad' : digest}` }, body });
  };
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await send(now, true)).status, 400); assert.equal((await send(now - 301)).status, 400);
  assert.equal((await send(now)).status, 200); const paidAt = f.row().formalData.closure.payment.paidAt;
  assert.equal((await send(now)).status, 200); assert.equal(f.row().formalData.closure.payment.paidAt, paidAt);
  assert.equal(closureView(f.row()).canSign, true); assert.equal(f.counts().creates, 1);
});

test('Stripe adapter collects only the initial rental and SMS, uses integer cents and stable idempotency', async t => {
  const previous = process.env.STRIPE_SECRET_KEY; process.env.STRIPE_SECRET_KEY = 'sk_test_unit_only';
  t.after(() => { if (previous === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previous; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, ...options }); return { ok: true, text: async () => JSON.stringify({ id: 'cs_test', url: 'https://checkout.stripe.com/test' }) }; });
  const row = request('RENT_QUOTE'), offer = buildClosureOffer(row, input());
  const args = { request: row, offer, payment: { id: 'stable-test', createdAt: new Date().toISOString() }, returnUrl: 'https://example.invalid/onboarding/test?contract=1' };
  await createOnboardingCheckout(args); await createOnboardingCheckout(args);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(calls[0].body.get('line_items[0][price_data][unit_amount]'), '1100');
  assert.equal(calls[0].body.get('line_items[1][price_data][unit_amount]'), '1000');
  assert.equal(calls[0].body.get('line_items[2][price_data][unit_amount]'), null);
  assert.equal(calls[0].body.get('metadata[offerHash]'), offer.hash);
  assert.equal(calls[0].body.get('payment_intent_data[metadata][paymentId]'), 'stable-test');
});
