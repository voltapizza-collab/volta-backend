import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import posUpdatesRoutes, { maintenanceContext, selectedRelease } from '../routes/posUpdates.js';
import { authenticateDevice, canonicalRequest } from '../services/posIdentity.js';

const deviceId = crypto.randomUUID();
const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const bytes = Buffer.from('signed APK fixture: transport tests, not an Android package');
const sha = sha256(bytes);
const deadline = () => new Date(Date.now() + 3600_000).toISOString();
function database() {
  const state = { device: { id: deviceId, status: 'AUTHORIZED', publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
    session: { id: 'session-original', storeId: 2, store: { active: false } }, orders: 0, nonces: new Set(), audits: [] };
  const db = {
    $queryRawUnsafe: async () => [],
    posDevice: { findUnique: async ({ where }) => where.id === deviceId ? state.device : null, update: async () => state.device },
    posDeviceNonce: { create: async ({ data }) => {
      if (state.nonces.has(data.nonce)) throw Object.assign(Error(), { code: 'P2002' });
      state.nonces.add(data.nonce);
    }, deleteMany: async () => {} },
    posSession: { findUnique: async () => state.session },
    sale: { count: async ({ where }) => { assert.deepEqual(where, { storeId: 2, status: 'PAID', processed: false }); return state.orders; } },
    posDeviceAudit: { create: async ({ data }) => state.audits.push(data) },
  };
  db.$transaction = async fn => fn(db);
  return { db, state };
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'volta-update-test-'));
  const apkPath = path.join(directory, 'update.apk');
  const catalogueFile = path.join(directory, 'catalogue.json');
  const release = { packageName: 'com.volta.poslab', versionCode: 17, versionName: '0.3.14-https', size: bytes.length,
    certificateSha256: 'a'.repeat(64), apkPath };
  const catalogue = { schema: 1, devices: { [deviceId]: { sha256: sha, maintenanceUntil: deadline() } }, releases: { [sha]: release } };
  await fs.writeFile(apkPath, bytes);
  const save = () => fs.writeFile(catalogueFile, JSON.stringify(catalogue));
  await save();
  const { db, state } = database();
  const events = [];
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use('/api/pos/updates', async (req, _res, next) => {
    req.posDevice = await authenticateDevice(db, req); next();
  }, posUpdatesRoutes(db, { catalogueFile, onEvent: row => events.push(row) }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.code || 'internal' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  function signed(suffix, method = 'GET', payload, fixedNonce) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const data = { deviceId, timestamp: String(Math.floor(Date.now() / 1000)), nonce: fixedNonce || crypto.randomBytes(24).toString('base64url'),
      method, path: `/api/pos/updates${suffix}`, body };
    return { method, ...(payload === undefined ? {} : { body }), headers: {
      'content-type': 'application/json', 'x-volta-device': deviceId, 'x-volta-time': data.timestamp, 'x-volta-nonce': data.nonce,
      'x-volta-signature': crypto.sign('sha256', Buffer.from(canonicalRequest(data)), pair.privateKey).toString('base64') } };
  }
  const request = (suffix, method, payload) => fetch(origin + '/api/pos/updates' + suffix, signed(suffix, method, payload));
  return { request, signed, origin, catalogue, save, apkPath, db, state, events };
}

test('authenticated selection exposes only assigned metadata without server paths', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/api/pos/updates/check')).status, 401);
  const result = await (await f.request('/check')).json();
  assert.equal(result.target.sha256, sha); assert.equal(result.target.apkPath, undefined);
  assert.equal(result.maintenance.storeId, 2);
  delete f.catalogue.devices[deviceId]; await f.save();
  assert.deepEqual(await (await f.request('/check')).json(), { target: null });
});
test('revoked devices, replayed requests and changed signed bodies are rejected', async t => {
  const f = await fixture(t);
  const options = f.signed('/check');
  assert.equal((await fetch(f.origin + '/api/pos/updates/check', options)).status, 200);
  assert.equal((await fetch(f.origin + '/api/pos/updates/check', options)).status, 401);
  const changed = f.signed('/prepare', 'POST', { sha256: sha, storeId: 2 });
  changed.body = JSON.stringify({ sha256: sha, storeId: 1 });
  assert.equal((await fetch(f.origin + '/api/pos/updates/prepare', changed)).status, 401);
  f.state.device.status = 'REVOKED';
  assert.equal((await f.request('/check')).status, 403);
});
test('download rejects unassigned, size-changed and same-size tampered APKs', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/apk/' + 'b'.repeat(64))).status, 403);
  const response = await f.request('/apk/' + sha);
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(f.events[0].event, 'apk_sent');
  await fs.writeFile(f.apkPath, Buffer.alloc(bytes.length));
  assert.equal((await f.request('/apk/' + sha)).status, 503);
  await fs.writeFile(f.apkPath, 'short');
  assert.equal((await f.request('/apk/' + sha)).status, 503);
});
test('maintenance requires authorization, a closed store and an empty queue', async () => {
  const { db, state } = database();
  const assignment = { maintenanceUntil: deadline() };
  assert.equal((await maintenanceContext(db, deviceId, assignment)).storeId, 2);
  assert.equal(await maintenanceContext(db, deviceId, {}), null);
  assert.equal(await maintenanceContext(db, deviceId, { maintenanceUntil: new Date(0).toISOString() }), null);
  assert.equal(await maintenanceContext(db, deviceId, { maintenanceUntil: new Date(Date.now() + 25 * 3600_000).toISOString() }), null);
  state.session.store.active = true;
  assert.equal(await maintenanceContext(db, deviceId, assignment), null);
  state.session.store.active = false; state.orders = 1;
  assert.equal(await maintenanceContext(db, deviceId, assignment), null);
  state.session = null;
  assert.deepEqual(await maintenanceContext(db, deviceId, assignment), { storeId: null, sessionId: null });
});
test('prepare rechecks changed target, store scope and new orders', async t => {
  const f = await fixture(t);
  const payload = { sha256: sha, storeId: 2 };
  assert.equal((await f.request('/prepare', 'POST', payload)).status, 200);
  assert.equal((await f.request('/prepare', 'POST', { ...payload, storeId: 1 })).status, 409);
  assert.equal((await f.request('/prepare', 'POST', { ...payload, sha256: 'b'.repeat(64) })).status, 409);
  f.state.orders = 1;
  assert.equal((await f.request('/prepare', 'POST', payload)).status, 409);
});
test('reports audit sanitized health without retaining arbitrary secrets', async t => {
  const f = await fixture(t);
  const report = { state: 'healthy', versionCode: 17, targetVersionCode: 17, foreground: true, printerReady: true, storeId: 2, token: 'never-store' };
  assert.equal((await f.request('/report', 'POST', report)).status, 200);
  assert.equal(f.state.audits[0].action, 'SOFTWARE_UPDATE');
  assert.equal(f.state.audits[0].details.token, undefined);
  assert.equal(f.state.audits[0].details.foreground, true);
  assert.equal((await f.request('/report', 'POST', { ...report, versionCode: -1 })).status, 400);
  assert.equal((await f.request('/report', 'POST', { ...report, error: 'raw exception containing secret' })).status, 400);
});
test('catalogue rejects package, size, version and certificate mistakes', () => {
  for (const change of [{ packageName: 'another.app' }, { size: 0 }, { size: 101 * 1024 * 1024 }, { versionCode: 1.5 }, { certificateSha256: 'bad' }]) {
    const release = { packageName: 'com.volta.poslab', size: 10, versionCode: 17, certificateSha256: 'a'.repeat(64), apkPath: 'local.apk', versionName: 'v', ...change };
    assert.throws(() => selectedRelease({ devices: { [deviceId]: { sha256: sha } }, releases: { [sha]: release } }, deviceId), { code: 'update_release_invalid' });
  }
});
