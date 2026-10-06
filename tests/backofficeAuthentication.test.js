import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import prisma from '../services/prisma.js';
import router from '../routes/partners.js';
import { hashWebPassword } from '../services/webSessions.js';

test('default partner login, voluntary short password change and recovery preserve account scope', async t => {
  const partner = { id: 17, slug: 'test-business', name: 'Test', active: 1, backofficePasswordHash: null };
  let tokenAvailable = true;
  t.mock.method(prisma, '$executeRawUnsafe', async (sql, hash) => {
    if (sql.includes('SET backofficePasswordHash = ?') && sql.includes('backofficeResetTokenHash = ?')) {
      if (!tokenAvailable) return 0;
      tokenAvailable = false; partner.backofficePasswordHash = hash; return 1;
    }
    if (sql.includes('SET backofficePasswordHash = ?')) partner.backofficePasswordHash = hash;
    return 1;
  });
  t.mock.method(prisma, '$queryRawUnsafe', async sql => {
    if (sql.includes('backofficeResetExpiresAt > NOW()')) return [{ id: partner.id, slug: partner.slug }];
    if (sql.includes('FROM Partner')) return [partner];
    return [];
  });
  const originalFindMany = prisma.store.findMany;
  prisma.store.findMany = async () => [{ id: 71, slug: 'central', storeName: 'Central' }];
  t.after(() => { prisma.store.findMany = originalFindMany; });
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-session']) req.webSession = { role: 'backoffice', partnerId: 17, partnerSlug: partner.slug, rememberDevice: true }; next(); });
  app.use('/partners', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const post = (path, body, session = false) => fetch(`http://127.0.0.1:${server.address().port}/partners/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'x-test-session': 'fixture' } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post('backoffice-login', { username: partner.slug, password: 'wrong' })).status, 401);
  assert.equal((await post('backoffice-login', { username: partner.slug, password: partner.slug, partnerSlug: 'other' })).status, 401);
  const initial = await post('backoffice-login', { username: partner.slug, password: partner.slug });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).rememberDevice, true);
  assert.equal((await post('backoffice-password/change', { currentPassword: partner.slug, password: 'abc' })).status, 403);
  assert.equal((await post('backoffice-password/change', { currentPassword: 'wrong', password: 'abc' }, true)).status, 400);
  const change = await post('backoffice-password/change', { currentPassword: partner.slug, password: 'abc' }, true);
  assert.equal(change.status, 200);
  assert.equal((await change.json()).sessionToken.length, 64);
  assert.equal((await post('backoffice-login', { username: partner.slug, password: 'abc' })).status, 200);
  assert.equal((await post('backoffice-login', { username: partner.slug, password: partner.slug })).status, 401);
  const password = 'a long personal passphrase';
  partner.backofficePasswordHash = hashWebPassword(password);
  assert.equal((await post('backoffice-login', { username: partner.slug, password, partnerSlug: 'other-business' })).status, 401);
  const login = await post('backoffice-login', { username: partner.slug, password, partnerSlug: partner.slug });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.role, 'backoffice');
  assert.equal(session.partnerId, 17);
  assert.equal(session.sessionToken.length, 64);
  assert.equal('backofficePasswordHash' in session, false);
  const token = 'a'.repeat(64);
  assert.equal((await post('backoffice-password/reset', { token, password: '' })).status, 400);
  assert.equal((await post('backoffice-password/reset', { token, password, partnerSlug: 'wrong' })).status, 400);
  const attempts = await Promise.all([post('backoffice-password/reset', { token, password: '123', partnerSlug: partner.slug }), post('backoffice-password/reset', { token, password: '123', partnerSlug: partner.slug })]);
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 400]);
});
