import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import checkoutRoutes from '../routes/checkout.js';
import { formatSale } from '../routes/myorders.js';

test('Stripe confirmation saves the paid method and state and remains idempotent', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  });
  let sale = { id: 1, code: 'PAYMENT-TEST', status: 'AWAITING_PAYMENT', products: [],
    stripeCheckoutSessionId: 'cs_payment_test',
    customerData: { paymentMode: 'card', paymentMethod: 'card', paymentStatus: 'awaiting_card_payment',
      email: 'saved@example.com', delivery: { method: 'PICKUP' } } };
  let writes = 0;
  const tx = {
    $queryRawUnsafe: async () => [],
    sale: { findUnique: async () => sale, update: async ({ data }) => {
      writes++; sale = { ...sale, ...data }; return sale;
    } },
  };
  const prisma = { $transaction: async fn => fn(tx), $queryRawUnsafe: async () => [] };
  let paid = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.stripe.com/v1/checkout/sessions/cs_payment_test');
    assert.equal(options.method, 'GET');
    return { ok: true, text: async () => JSON.stringify({ id: 'cs_payment_test',
      payment_status: paid ? 'paid' : 'unpaid', payment_intent: 'pi_payment_test',
      customer_details: { email: 'stripe@example.com' }, metadata: { purpose: 'order_checkout', saleId: '1' } }) };
  };
  const app = express(); app.use(express.json()); app.use(checkoutRoutes(prisma));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const confirm = () => originalFetch(`http://127.0.0.1:${server.address().port}/session/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cs_payment_test' }),
  });
  const unpaid = await confirm();
  assert.equal(unpaid.status, 409);
  assert.equal(writes, 0);
  assert.equal(sale.customerData.paymentStatus, 'awaiting_card_payment');

  paid = true;
  const confirmed = await confirm();
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).notified, true);
  assert.equal(writes, 1);
  assert.equal(sale.status, 'PAID');
  assert.equal(sale.customerData.paymentMode, 'card');
  assert.equal(sale.customerData.paymentMethod, 'card');
  assert.equal(sale.customerData.paymentStatus, 'card_paid');
  assert.equal(sale.customerData.email, 'saved@example.com');
  assert.deepEqual(sale.customerData.delivery, { method: 'PICKUP' });
  assert.equal(formatSale(sale).paymentStatus, 'card_paid');

  const repeated = await confirm();
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).notified, false);
  assert.equal(writes, 1);
});
