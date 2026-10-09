import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import onboardingRoutes from '../routes/onboarding.js';
import { isPublicWebRoute } from '../services/webAccess.js';

async function fixture(t, sendEmail = async () => ({ ok: true })) {
  let row;
  const emails = [];
  const db = { onboardingRequest: {
    create: async ({ data }) => row = { id: 7, ...data, createdAt: new Date(), emailStatus: 'PENDING' },
    findUnique: async ({ where }) => row && (where.id === row.id || where.token === row.token) ? structuredClone(row) : null,
    findMany: async () => row ? [structuredClone(row)] : [],
    update: async ({ data }) => row = { ...row, ...data },
  }, onboardingPricing: { findUnique: async () => null }, $queryRawUnsafe: async () => [] };
  db.$transaction = fn => fn(db);
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.get('x-test-role')) req.webSession = { role: req.get('x-test-role') }; next(); });
  app.use(onboardingRoutes(db, { sendEmail: async payload => { emails.push(payload); return sendEmail(payload); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, role, method = 'POST') => fetch(origin + path, { method,
    headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  const lead = { name: '<script>Test</script>', business: 'Test Pizza', email: 'owner@example.invalid', phone: '600000000', message: 'Quiero una demo', formalData: { closure: {} } };
  return { call, lead, emails, row: () => row };
}

test('demo saves a separate inquiry, confirms without onboarding and blocks form/contract/payment paths', async t => {
  const f = await fixture(t);
  const response = await f.call('/demo-requests', f.lead);
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.row().formalData.requestKind, 'DEMO'); assert.equal(f.row().status, 'RECEIVED');
  assert.equal(f.row().formalData.commercialCatalog, undefined); assert.equal(f.emails.length, 1);
  assert.match(f.emails[0].html, /&lt;script&gt;/);
  assert.doesNotMatch(f.emails[0].html + f.emails[0].text, /fase 2|posChoice|\/onboarding\/|Elige cómo pagar/);
  assert.doesNotMatch(f.emails[0].html, /<script>/);
  assert.match(f.emails[0].text, /El motor para vender pizzas por Internet/);
  const token = f.row().token;
  assert.equal((await f.call(`/form/${token}`, undefined, null, 'GET')).status, 404);
  for (const suffix of ['', '/draft', '/sign-contract', '/closure/checkout']) assert.equal((await f.call(`/form/${token}${suffix}`, {})).status, 404);
  assert.equal((await f.call('/requests/7/contract/send', {}, 'global_admin')).status, 409);
  assert.equal((await f.call('/requests/7e0/contract/send', {}, 'global_admin')).status, 409);
  assert.equal((await f.call(`/form/%${token.charCodeAt(0).toString(16)}${token.slice(1)}`, undefined, null, 'GET')).status, 404);
  assert.equal((await f.call('/requests/7/status', { status: 'ACTIVATED' }, 'global_admin', 'PATCH')).status, 409);
  const list = await (await f.call('/requests', undefined, 'global_admin', 'GET')).json();
  assert.equal(list.requests[0].requestKind, 'DEMO'); assert.equal(list.requests[0].formalUrl, null); assert.equal(list.requests[0].token, undefined);
});

test('only an admin can explicitly invite an interested business; repeat invitation is idempotent', async t => {
  const f = await fixture(t); await f.call('/demo-requests', f.lead);
  assert.equal((await f.call('/requests/7/invite-onboarding', { requestedByBusiness: true })).status, 403);
  assert.equal((await f.call('/requests/7/invite-onboarding', { requestedByBusiness: true }, 'backoffice')).status, 403);
  assert.equal((await f.call('/requests/7/invite-onboarding', {}, 'global_admin')).status, 400);
  assert.equal(f.emails.length, 1);
  const response = await f.call('/requests/7/invite-onboarding', { requestedByBusiness: true }, 'global_admin');
  assert.equal(response.status, 200); const payload = await response.json();
  assert.equal(payload.request.requestKind, 'ONBOARDING'); assert.equal(payload.request.status, 'EMAIL_SENT');
  assert.match(f.emails[1].text, /Continuar a la fase 2/); assert.ok(f.row().formalData.commercialCatalog);
  assert.equal((await f.call(`/form/${f.row().token}`, undefined, null, 'GET')).status, 200);
  assert.equal((await f.call('/requests/7/invite-onboarding', { requestedByBusiness: true }, 'global_admin')).status, 200);
  assert.equal(f.emails.length, 2);
});

test('email failures retain the demo for follow-up and failed invitation can be retried', async t => {
  let succeeds = false;
  const f = await fixture(t, async () => ({ ok: succeeds, reason: 'unavailable' }));
  assert.equal((await f.call('/demo-requests', f.lead)).status, 201);
  assert.equal(f.row().emailStatus, 'FAILED');
  assert.equal((await f.call('/requests/7/invite-onboarding', { requestedByBusiness: true }, 'global_admin')).status, 503);
  assert.equal(f.row().formalData.requestKind, 'DEMO');
  succeeds = true;
  assert.equal((await f.call('/requests/7/invite-onboarding', { requestedByBusiness: true }, 'global_admin')).status, 200);
});

test('demo boundary is public only for creation and invalid input creates nothing', async t => {
  assert.equal(isPublicWebRoute('POST', '/onboarding/demo-requests'), true);
  assert.equal(isPublicWebRoute('GET', '/onboarding/demo-requests'), false);
  assert.equal(isPublicWebRoute('POST', '/onboarding/requests/7/invite-onboarding'), false);
  const f = await fixture(t);
  assert.equal((await f.call('/demo-requests', { name: 'Test', business: 'Test', email: 'invalid' })).status, 400);
  assert.equal(f.row(), undefined); assert.equal(f.emails.length, 0);
});

test('invitation in progress rejects a duplicate and closed demos cannot be invited', async t => {
  let release;
  let started;
  const sending = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, payload => payload.subject.includes('iniciar el alta')
    ? new Promise(resolve => { release = () => resolve({ ok: true }); started(); }) : { ok: true });
  await f.call('/demo-requests', f.lead);
  const first = f.call('/requests/7/invite-onboarding', { requestedByBusiness: true }, 'global_admin');
  await sending;
  try {
    assert.equal((await f.call('/requests/7/invite-onboarding', { requestedByBusiness: true }, 'global_admin')).status, 409);
    assert.equal((await f.call('/requests/7/status', { status: 'REJECTED' }, 'global_admin', 'PATCH')).status, 409);
  } finally { release(); }
  assert.equal((await first).status, 200);
  assert.equal(f.emails.length, 2);
  await f.call('/demo-requests', f.lead);
  await f.call('/requests/7/status', { status: 'REJECTED', reviewerNote: 'No continúa' }, 'global_admin', 'PATCH');
  assert.equal((await f.call('/requests/7/invite-onboarding', { requestedByBusiness: true }, 'global_admin')).status, 409);
});
