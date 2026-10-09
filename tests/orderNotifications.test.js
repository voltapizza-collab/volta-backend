import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getOrderDisplayCode } from '../services/orderDisplayCode.js';
import { estimateSmsParts } from '../services/telnyx.js';
import { buildOrderTrackingUrl, sendOrderPaidTrackingSms, sendOrderReadySms, sendOrderCustomerMessageSms } from '../services/orderNotifications.js';
import { sendBoostPurchasedTrackingSms } from '../services/trackingNotifications.js';
import express from 'express';
import salesRoutes from '../routes/sales.js';
import { createOrderCheckoutSession, createBoostCheckoutSession } from '../services/stripe.js';

const code = `WEB-${'A'.repeat(32)}`;
const settings = { schemaVersion: 2, enabled: true, contactPhoneConfirmed: true, recipientPhone: '612345678', services: {
  customerPaymentSuccess: true, customerOrderReady: true, customerOrderChatMessage: true, boostPurchased: true,
} };
const sale = { id: 775, code, partnerId: 1, storeId: 2, customerId: 3, delivery: 'PICKUP',
  partner: { id: 1, name: 'Pizza', trackingNotificationSettings: settings },
  customerData: { name: 'Ana Perez', phone: '612345678' }, store: { id: 2, storeName: 'Plaza de Ary' },
};
const prisma = { partner: { findUnique: async () => ({ trackingNotificationSettings: settings }) } };
function mockTransport({ fail = false, credit = true } = {}) {
  const calls = {};
  return { calls, deps: {
    reserveSmsCreditForMessage: async (_, payload) => { calls.reserve = payload; return { ok: credit, ledgerId: 10, error: 'insufficient_credits' }; },
    refundSmsCreditForMessage: async (_, payload) => { calls.refund = payload; return { ok: true }; },
    sendTelnyxSms: async payload => { calls.send = payload; return { ok: !fail, error: fail ? { title: 'test_failure' } : undefined }; },
  } };
}

test('display code contract preserves historical codes and invalid ID fallbacks', () => {
  assert.equal(getOrderDisplayCode(sale), 'WEB-775');
  assert.equal(getOrderDisplayCode({ code: code.toLowerCase(), id: '776' }), 'WEB-776');
  for (const id of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'invalid']) assert.equal(getOrderDisplayCode({ code, id }), code);
  assert.equal(getOrderDisplayCode({ code: 'WEB-12345', id: 8 }), 'WEB-12345');
  assert.equal(getOrderDisplayCode({ code: 'POS-8', id: 8 }), 'POS-8');
  assert.equal(getOrderDisplayCode({ id: 8 }), '8');
  assert.equal(getOrderDisplayCode(null), '-');
});

test('display codes match the POS including historical and invalid ID fallbacks', async t => {
  let source;
  try { source = await readFile(new URL('../../volta-storefront/src/pos/orderDisplayCode.js', import.meta.url), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('Cross-repository parity requires the storefront checkout'); throw error; }
  const { getPosOrderCode } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const order of [sale, { ...sale, id: '776', code: code.toLowerCase() }, {}, null,
    ...[undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'invalid'].map(id => ({ code, id })),
    { code: 'WEB-12345', id: 8 }, { code: 'POS-8', id: 8 }, { id: 8 }]) {
    assert.equal(getOrderDisplayCode(order), getPosOrderCode(order));
  }
  assert.equal(getOrderDisplayCode(sale), 'WEB-775');
  assert.equal(sale.code, code);
});

for (const fail of [false, true]) {
  for (const kind of ['paid', 'pickup', 'delivery', 'chat']) {
    test(`${kind} SMS ${fail ? 'failure refunds' : 'reserves'} the final segments and preserves technical references`, async () => {
      const { calls, deps } = mockTransport({ fail });
      const order = { ...sale, delivery: kind === 'delivery' ? 'COURIER' : 'PICKUP' };
      const result = kind === 'paid' ? await sendOrderPaidTrackingSms(prisma, order, deps)
        : kind === 'chat' ? await sendOrderCustomerMessageSms(prisma, order, 'Tu pizza está lista 🍕', deps)
          : await sendOrderReadySms(prisma, order, deps);
      assert.equal(result.ok, !fail);
      const estimate = estimateSmsParts(calls.send.text);
      assert.equal(calls.reserve.quantity, estimate.parts);
      assert.deepEqual(calls.reserve.meta.smsEstimate, estimate);
      assert.equal(calls.reserve.couponCode, code);
      assert.ok(calls.send.tags.some(tag => tag.includes(code)));
      if (fail) { assert.equal(calls.refund.quantity, estimate.parts); assert.equal(calls.refund.couponCode, code); }
      else assert.equal(calls.refund, undefined);
      if (kind !== 'chat') assert.match(calls.send.text, /[Pp]edido WEB-775[. ]/);
      if (kind === 'paid' || kind === 'chat') {
        assert.ok(calls.send.text.includes(buildOrderTrackingUrl(order)));
        assert.equal(calls.send.text.split(code).length - 1, 1);
        if (kind === 'chat') assert.ok(calls.send.text.endsWith('?chat=1#chat'));
      } else assert.ok(!calls.send.text.includes(code));
    });
  }
}

test('insufficient credit prevents a send; historical codes remain visible', async () => {
  const blocked = mockTransport({ credit: false });
  const result = await sendOrderReadySms(prisma, sale, blocked.deps);
  assert.equal(result.reason, 'insufficient_credits');
  assert.equal(blocked.calls.send, undefined);
  const legacy = mockTransport();
  await sendOrderReadySms(prisma, { ...sale, code: 'WEB-12345' }, legacy.deps);
  assert.match(legacy.calls.send.text, /pedido WEB-12345/);
});

test('short codes reduce complete messages at GSM and Unicode segment boundaries', async () => {
  for (const [name, storeName] of [['Pizza', 'A'.repeat(90)], ['Pizzería', 'Á'.repeat(20)], ['Restaurante de nombre muy largo', 'Centro comercial de nombre muy largo '.repeat(4)]]) {
    const { calls, deps } = mockTransport();
    await sendOrderReadySms(prisma, { ...sale, partner: { name }, store: { storeName } }, deps);
    const after = estimateSmsParts(calls.send.text);
    const before = estimateSmsParts(calls.send.text.replace('WEB-775', code));
    assert.equal(before.length - after.length, 29);
    assert.ok(after.parts <= before.parts);
    if (name !== 'Restaurante de nombre muy largo') assert.ok(after.parts < before.parts);
    assert.equal(calls.reserve.quantity, after.parts);
  }
});

test('Boost SMS shows the short number while ledger metadata retains the public code', async () => {
  const { calls, deps } = mockTransport();
  await sendBoostPurchasedTrackingSms(prisma, { sale }, deps);
  assert.match(calls.send.text, /Boost WEB-775/);
  assert.equal(calls.reserve.meta.orderCode, code);
});

test('tracking and chat retain full-code lookup; the short display number grants no access', async t => {
  const updates = [];
  const app = express(); app.use(express.json());
  app.use(salesRoutes({ sale: {
    findUnique: async ({ where }) => where.code === code ? { ...sale, status: 'PAID', processed: true } : null,
    update: async payload => { updates.push(payload); },
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await fetch(`${origin}/seguimiento/${code}`).then(r => r.json());
  assert.equal(result.code, code);
  assert.equal(result.displayCode, 'WEB-775');
  const chat = await fetch(`${origin}/seguimiento/${code}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Ya llego' }) });
  assert.equal(chat.status, 200);
  assert.equal(updates[0].where.id, 775);
  assert.equal(updates[0].data.customerData.chatMessages[0].text, 'Ya llego');
  assert.equal((await fetch(`${origin}/seguimiento/WEB-775`)).status, 404);
  assert.equal((await fetch(`${origin}/seguimiento/WEB-775/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hola' }) })).status, 404);
  assert.equal(updates.length, 1);
});

test('payment descriptions use the short number but Stripe metadata preserves the full reference', async t => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_local';
  t.after(() => { if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previousKey; });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    requests.push(new URLSearchParams(options.body));
    return { ok: true, text: async () => JSON.stringify({ id: 'cs_test', url: 'https://example.test/checkout' }) };
  });
  const common = { sale, amountCents: 1000, successUrl: buildOrderTrackingUrl(sale), cancelUrl: buildOrderTrackingUrl(sale) };
  await createOrderCheckoutSession({ ...common, partner: sale.partner, store: sale.store });
  await createBoostCheckoutSession({ ...common, quote: { currentPosition: 3, targetPosition: 1 } });
  for (const body of requests) {
    assert.ok(body.get('line_items[0][price_data][product_data][name]').includes('WEB-775'));
    assert.ok(!body.get('line_items[0][price_data][product_data][name]').includes(code));
    assert.equal(body.get('metadata[orderCode]'), code);
    assert.equal(body.get('success_url'), buildOrderTrackingUrl(sale));
  }
});
