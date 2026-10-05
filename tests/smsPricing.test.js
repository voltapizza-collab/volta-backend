import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import smsRoutes from '../routes/smsCredits.js';
import { normalizeSmsPrice, creditsFromAmount, readSmsPrice } from '../services/smsCredits.js';
import { newOnboardingCatalog, updateOnboardingPricing } from '../services/onboardingPricing.js';

function fixture() {
  let pricing = { id: 1, posTotalCents: 25000, revision: 0, defaults: {} }, balance = 8;
  const ledgers = [];
  const db = { onboardingPricing: {
    findUnique: async () => structuredClone(pricing), upsert: async () => pricing,
    updateMany: async ({ where, data }) => {
      if (where.revision !== pricing.revision) return { count: 0 };
      pricing = { ...pricing, ...data, revision: pricing.revision + 1 }; return { count: 1 };
    },
  }, partner: {
    findUnique: async () => ({ id: 1, name: 'Test', slug: 'test', smsCredits: balance, smsLowBalanceThreshold: 5 }),
    aggregate: async () => ({ _sum: { smsCredits: balance } }),
    update: async ({ data }) => { balance += data.smsCredits.increment; return { id: 1, smsCredits: balance }; },
  }, smsCreditLedger: {
    findFirst: async ({ where }) => ledgers.find(row => row.reference === where.reference) || null,
    findMany: async () => ledgers,
    create: async ({ data }) => { const row = { id: ledgers.length + 1, ...data }; ledgers.push(row); return row; },
  } };
  db.$transaction = fn => fn(db);
  return { db, ledgers, balance: () => balance };
}

test('current SMS price accepts fractional cents and changes new packages without changing existing credits', async () => {
  const f = fixture();
  assert.equal(await readSmsPrice(f.db), '0.0750');
  assert.equal(creditsFromAmount(10), 133);
  assert.equal(normalizeSmsPrice('0,0800'), '0.0800');
  for (const invalid of [0, -1, '0.00001', '', 'x', Infinity, 11]) assert.throws(() => normalizeSmsPrice(invalid), /invalid_sms_price/);
  await updateOnboardingPricing(f.db, { posTotalCents: 25000, revision: 0, defaults: { smsUnitPriceEur: '0.08' } }, 'test');
  assert.equal(await readSmsPrice(f.db), '0.0800');
  const catalog = await newOnboardingCatalog(f.db);
  assert.equal(catalog.sms.packages[0].credits, 125);
  assert.equal(catalog.sms.initialRecharge, 'SEPARATE');
  assert.equal(f.balance(), 8);
  await assert.rejects(updateOnboardingPricing(f.db, { posTotalCents: 25000, revision: 0, defaults: { smsUnitPriceEur: '0.09' } }, 'test'), /pricing_changed/);
  await updateOnboardingPricing(f.db, { posTotalCents: 26000, revision: 1, defaults: {} }, 'old-client');
  assert.equal(await readSmsPrice(f.db), '0.0800');
});

test('quotes and checkout use current price; stale quotes are rejected and paid sessions retain purchased credits', async t => {
  const f = fixture();
  for (const [key, value] of Object.entries({ STRIPE_SECRET_KEY: 'sk_test_only', STRIPE_WEBHOOK_SECRET: 'whsec_test_only', TELNYX_API_KEY: '' })) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  const originalFetch = globalThis.fetch; let session, calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (!String(url).startsWith('https://api.stripe.com/')) return originalFetch(url, options);
    calls++; const params = new URLSearchParams(options.body);
    session = { id: 'cs_test_sms', payment_status: 'paid', amount_total: 1000, metadata: {} };
    for (const key of ['purpose', 'partnerId', 'amountCents', 'credits', 'unitPriceEur']) session.metadata[key] = params.get(`metadata[${key}]`);
    return { ok: true, text: async () => JSON.stringify({ ...session, url: 'https://example.invalid/checkout' }) };
  });
  const app = express(); app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } })); app.use(smsRoutes(f.db));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  await updateOnboardingPricing(f.db, { posTotalCents: 25000, revision: 0, defaults: { smsUnitPriceEur: '0.08' } }, 'test');
  const quote = await (await fetch(base + '/quote?amount=10')).json(); assert.equal(quote.credits, 125); assert.equal(quote.sellPrice, 0.08);
  const wallet = await (await fetch(base + '/1')).json(); assert.equal(wallet.packages[0].credits, 125); assert.equal(wallet.balance.sellPrice, 0.08);
  assert.equal((await post('/1/checkout-session', { packageAmount: 10, smsUnitPriceEur: '0.075' })).status, 409); assert.equal(calls, 0);
  assert.equal((await post('/1/checkout-session', { packageAmount: 10, smsUnitPriceEur: '0.08', quantity: 999999 })).status, 200);
  assert.equal(session.metadata.credits, '125'); assert.equal(session.metadata.unitPriceEur, '0.0800');
  await updateOnboardingPricing(f.db, { posTotalCents: 25000, revision: 1, defaults: { smsUnitPriceEur: '0.1' } }, 'test');
  const event = { type: 'checkout.session.completed', data: { object: session } }, timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', 'whsec_test_only').update(`${timestamp}.${JSON.stringify(event)}`).digest('hex');
  const headers = { 'stripe-signature': `t=${timestamp},v1=${signature}` };
  assert.equal((await post('/stripe/webhook', event, headers)).status, 200);
  assert.equal(f.balance(), 133); assert.equal(f.ledgers[0].quantity, 125); assert.equal(f.ledgers[0].unitPrice, '0.0800');
  assert.equal((await post('/stripe/webhook', event, headers)).status, 200); assert.equal(f.ledgers.length, 1);
});
