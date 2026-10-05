import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { webAccess, authorizeBackoffice, assertWebInput, isPublicWebRoute } from '../services/webAccess.js';
import { issueWebSession, readWebSession, revokeWebSession, hashWebPassword, verifyWebPassword, tokenHash } from '../services/webSessions.js';
import { safeActivation, issueBackofficeInvitation } from '../services/backofficeInvitation.js';
import webAuthRoutes from '../routes/webAuth.js';

function database() {
  const sessions = new Map();
  const partners = [{ id: 1, name: 'A', slug: 'a', active: 1, backofficePasswordHash: 'credential-a' }, { id: 2, name: 'B', slug: 'b', active: 1, backofficePasswordHash: 'credential-b' }];
  const stores = [{ id: 11, partnerId: 1, slug: 'central', posPinHash: 'pin-a', posCredentialsEnabled: true }, { id: 12, partnerId: 1, slug: 'second', posPinHash: 'pin-second', posCredentialsEnabled: true }, { id: 21, partnerId: 2, slug: 'central', posPinHash: 'pin-b' }];
  const db = { sessions, partners, stores,
    $executeRawUnsafe: async (sql, ...args) => {
      if (sql.startsWith('INSERT INTO WebSession')) { const [hash, role, partnerId, storeId, credentialHash, expiresAt] = args; sessions.set(hash, { role, partnerId, storeId, credentialHash, expiresAt }); }
      if (sql.startsWith('DELETE FROM WebSession')) sessions.delete(args[0]);
      return 1;
    },
    $queryRawUnsafe: async (sql, key) => {
      if (sql.includes('FROM WebSession')) { const row = sessions.get(key); return row && row.expiresAt > new Date() ? [row] : []; }
      if (sql.includes('FROM Partner')) return partners.filter(p => p.id === key);
      return [];
    },
    store: { findUnique: async ({ where }) => stores.find(s => s.id === where.id), findFirst: async ({ where }) => stores.find(s => s.id === where.id && s.partnerId === where.partnerId) },
    customer: { findUnique: async ({ where }) => ({ id: where.id, partnerId: where.id === 101 ? 1 : 2 }) },
    menuPizza: { findUnique: async ({ where }) => ({ id: where.id, partnerId: where.id === 301 ? 1 : 2 }) },
    sale: { findUnique: async ({ where }) => ({ id: where.id, partnerId: where.id === 501 ? 1 : 2, storeId: where.id === 501 ? 11 : 21 }), findFirst: async ({ where }) => where.id === 501 && where.partnerId === 1 && where.storeId === 11 ? { id: 501 } : null },
  };
  return db;
}

test('opaque sessions are server-verified, expire, revoke and invalidate on credential/partner changes', async () => {
  const db = database();
  const session = await issueWebSession(db, { role: 'backoffice', partnerId: 1, storeId: 11 }, 'credential-a');
  assert.equal(session.sessionToken.length, 64);
  assert.equal(db.sessions.has(session.sessionToken), false);
  const bearer = `Bearer ${session.sessionToken}`;
  assert.equal((await readWebSession(db, bearer)).partnerSlug, 'a');
  assert.equal(await readWebSession(db, 'Bearer made-up'), null);
  db.partners[0].active = 0;
  assert.equal(await readWebSession(db, bearer), null);
  db.partners[0].active = 1;
  db.partners[0].backofficePasswordHash = 'new-credential';
  assert.equal(await readWebSession(db, bearer), null);
  db.partners[0].backofficePasswordHash = 'credential-a';
  db.sessions.get(tokenHash(session.sessionToken)).expiresAt = new Date(0);
  assert.equal(await readWebSession(db, bearer), null);
  await revokeWebSession(db, bearer);
  assert.equal(db.sessions.size, 0);
});

test('a regenerated or disabled POS PIN invalidates its web session', async () => {
  const db = database();
  const s = await issueWebSession(db, { role: 'pos', partnerId: 1, storeId: 11 }, 'pin-a');
  const header = `Bearer ${s.sessionToken}`;
  assert.equal((await readWebSession(db, header)).storeId, 11);
  db.stores[0].posCredentialsEnabled = false;
  assert.equal(await readWebSession(db, header), null);
  db.stores[0].posCredentialsEnabled = true;
  db.stores[0].posPinHash = 'regenerated';
  assert.equal(await readWebSession(db, header), null);
});

test('HTTP boundary denies anonymous, foreign ownership, role escalation and unknown routes', async t => {
  const db = database();
  const bo = await issueWebSession(db, { role: 'backoffice', partnerId: 1, storeId: 11 }, 'credential-a');
  const pos = await issueWebSession(db, { role: 'pos', partnerId: 1, storeId: 11 }, 'pin-a');
  const app = express(); app.use(express.json()); app.use('/api/auth', webAuthRoutes(db)); app.use(webAccess(db));
  app.use((req, res) => res.json({ reached: true, query: req.query, body: req.body }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const request = (path, session = bo, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { ...(session ? { Authorization: `Bearer ${session.sessionToken}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('/api/myorders/pending', null)).status, 401);
  assert.equal((await request('/api/stores/1e1/pos-credentials', null)).status, 401);
  assert.equal((await request('/stores/0xA/report', null)).status, 401);
  assert.equal((await request('/api/myorders/pending?partnerId=2')).status, 403);
  assert.equal((await request('/api/myorders/pending?partnerId=1&partnerId=2')).status, 403);
  assert.equal((await request('/stores/21/report')).status, 403);
  assert.equal((await request('/api/stores/21', bo, 'PATCH', { storeName: 'hijack' })).status, 403);
  assert.equal((await request('/api/customers/202')).status, 403);
  assert.equal((await request('/api/customers/101')).status, 200);
  assert.equal((await request('/api/pizzas/302', bo, 'DELETE')).status, 403);
  assert.equal((await request('/api/stores/11', bo, 'PATCH', { partnerId: 2 })).status, 403);
  assert.equal((await request('/api/sms-credits/1/recharge', bo, 'POST', { amount: 100 })).status, 403);
  assert.equal((await request('/api/onboarding/requests')).status, 403);
  assert.equal((await request('/a-new-private-route')).status, 403);
  const ownList = await (await request('/api/myorders/pending')).json();
  assert.equal(ownList.query.partnerId, '1');
  assert.equal((await request('/api/myorders/501/messages', pos)).status, 200);
  assert.equal((await request('/api/myorders/502/messages', pos)).status, 403);
  assert.equal((await request('/api/stores/12/active', pos, 'PATCH', { active: true })).status, 403);
  assert.equal((await request('/api/billing/1/summary', pos)).status, 403);
  assert.equal((await request('/api/auth/session?role=backoffice&partnerSlug=b')).status, 403);
  assert.equal((await request('/api/auth/session?role=backoffice&partnerSlug=a')).status, 200);
  assert.equal((await request('/api/checkout/session', null, 'POST', {})).status, 200);
  assert.equal((await request('/api/myorders/queue-size?partnerId=1&storeId=11', null)).status, 200);
  await request('/api/auth/session', bo, 'DELETE');
  assert.equal((await request('/api/myorders/pending')).status, 401);
});

test('multipart fields and nested references cannot change business', async () => {
  const db = database();
  const req = { webSession: { role: 'backoffice', partnerId: 1 }, query: {}, body: { partnerId: '2' } };
  await assert.rejects(assertWebInput(req, db), /business_scope_denied/);
  req.body = { partnerId: '1', storeIds: '[11,21]' };
  await assert.rejects(assertWebInput(req, db), /business_scope_denied/);
  req.body = { nested: { customerId: 202 } };
  await assert.rejects(assertWebInput(req, db), /business_scope_denied/);
  req.body = { partnerId: '1', storeIds: '[11,12]' };
  await assertWebInput(req, db);
});

test('password hashing and activation redaction preserve only public access details', async () => {
  const hash = hashWebPassword('a sufficiently long passphrase');
  assert.equal(verifyWebPassword('a sufficiently long passphrase', hash), true);
  assert.equal(verifyWebPassword('wrong', hash), false);
  assert.equal(verifyWebPassword('a', 'broken'), false);
  const safe = safeActivation({ partnerSlug: 'a', password: 'old', posPin: 'secret', invitationUrl: 'secret-link', posCredentials: [{ storeId: 11, pin: 'secret' }] });
  assert.equal(JSON.stringify(safe).includes('secret'), false);
  const calls = [];
  const link = await issueBackofficeInvitation({ $executeRawUnsafe: async (...args) => calls.push(args) }, 1, 'a', 'https://example.test');
  const token = new URL(link).searchParams.get('reset');
  assert.equal(new URL(link).pathname, '/backoffice/a');
  assert.equal(calls[0][1], tokenHash(token));
  assert.equal(JSON.stringify(calls).includes(token), false);
});

test('public methods are explicit; sensitive collections and credential endpoints stay private', () => {
  assert.equal(isPublicWebRoute('GET', '/partners/a'), true);
  assert.equal(isPublicWebRoute('PATCH', '/partners/a'), false);
  assert.equal(isPublicWebRoute('GET', '/stores/11/pos-credentials'), false);
  assert.equal(isPublicWebRoute('GET', '/stores/1e1/pos-credentials'), false);
  assert.equal(isPublicWebRoute('GET', '/stores/1e1/ingredients'), false);
  assert.equal(isPublicWebRoute('GET', '/stores/123/central'), true);
  assert.equal(isPublicWebRoute('GET', '/customers'), false);
  assert.equal(isPublicWebRoute('GET', '/myorders/repeat/recent'), false);
  assert.equal(isPublicWebRoute('GET', '/onboarding/requests'), false);
  assert.equal(isPublicWebRoute('POST', '/onboarding/requests'), true);
});
