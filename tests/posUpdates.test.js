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
import posIdentityRoutes from '../routes/posIdentity.js';
import { assignRelease } from '../services/posReleaseRegistry.js';
import { artifactId, verifyArtifact, fetchReleaseArtifact } from '../services/posReleaseStorage.js';
import { Readable } from 'node:stream';
import { validatePublication } from '../services/posApkVerification.js';

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

async function fixture(t, production = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'volta-update-test-'));
  const apkPath = path.join(directory, 'update.apk');
  const catalogueFile = path.join(directory, 'catalogue.json');
  const release = { packageName: 'com.volta.poslab', versionCode: 17, versionName: '0.3.14-https', size: bytes.length,
    certificateSha256: 'a'.repeat(64), apkPath, title: 'Actualizaciones con tu autorización', releaseNotes: 'Consulta las novedades y elige cuándo actualizar.' };
  const catalogue = { schema: 1, devices: { [deviceId]: { sha256: sha, maintenanceUntil: deadline() } }, releases: { [sha]: release } };
  await fs.writeFile(apkPath, bytes);
  const save = () => fs.writeFile(catalogueFile, JSON.stringify(catalogue));
  await save();
  const { db, state } = database();
  state.assignment = { release: { ...release, sha256: sha, enabled: true,
    artifactKey: artifactId(sha) } };
  state.softwareStatus = null;
  db.posUpdateAssignment = {
    findUnique: async () => state.assignment,
    upsert: async ({ create, update }) => { state.assignment = { ...(state.assignment ? update : create), release: state.assignment?.release }; return state.assignment; },
  };
  db.posSoftwareRelease = { findUnique: async () => state.assignment?.release };
  db.posSoftwareStatus = {
    findUnique: async () => state.softwareStatus,
    upsert: async ({ create, update }) => { state.softwareStatus = state.softwareStatus ? { ...state.softwareStatus, ...update } : create; return state.softwareStatus; },
  };
  const events = [];
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use('/api/pos/updates', async (req, _res, next) => {
    req.posDevice = await authenticateDevice(db, req); next();
  }, posUpdatesRoutes(db, { ...(production ? { loadArtifact: async () => fs.readFile(apkPath) } : { catalogueFile }), onEvent: row => events.push(row) }));
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
  assert.equal(result.target.releaseNotes, f.catalogue.releases[sha].releaseNotes);
  assert.equal(result.maintenance.storeId, 2);
  delete f.catalogue.devices[deviceId]; await f.save();
  assert.deepEqual(await (await f.request('/check')).json(), { target: null });
});

test('production registry selects a durable DB release and never exposes storage identifiers', async t => {
  const f = await fixture(t, true);
  const result = await (await f.request('/check')).json();
  assert.equal(result.target.sha256, sha);
  assert.equal(result.target.artifactKey, undefined);
  assert.equal(result.target.apkPath, undefined);
  assert.ok(f.state.softwareStatus.lastCheckAt instanceof Date);
  // The old temporary catalogue is irrelevant, even if its window has expired.
  f.catalogue.devices[deviceId].maintenanceUntil = new Date(0).toISOString(); await f.save();
  assert.equal((await f.request('/prepare', 'POST', { sha256: sha, storeId: 2 })).status, 200);
  assert.deepEqual(Buffer.from(await (await f.request('/apk/' + sha)).arrayBuffer()), bytes);
});

test('withdrawing a database release immediately stops discovery, download and prepare', async t => {
  const f = await fixture(t, true);
  f.state.assignment.release.enabled = false;
  assert.deepEqual(await (await f.request('/check')).json(), { target: null });
  assert.equal((await f.request('/apk/' + sha)).status, 403);
  assert.equal((await f.request('/prepare', 'POST', { sha256: sha, storeId: 2 })).status, 409);
  f.state.assignment = null;
  assert.deepEqual(await (await f.request('/check')).json(), { target: null });
});

test('durable downloads still reject altered bytes and unauthorized terminals', async t => {
  const f = await fixture(t, true);
  await fs.writeFile(f.apkPath, Buffer.alloc(bytes.length));
  assert.equal((await f.request('/apk/' + sha)).status, 503);
  f.state.device.status = 'REVOKED';
  assert.equal((await f.request('/check')).status, 403);
});

test('software status persists reports, deduplicates audit and ignores delayed older reports', async t => {
  const f = await fixture(t, true);
  const report = { state: 'healthy', versionCode: 19, targetVersionCode: 19, foreground: true, printerReady: true, storeId: 2 };
  for (let i = 0; i < 2; i++) assert.equal((await f.request('/report', 'POST', report)).status, 200);
  assert.equal(f.state.softwareStatus.versionCode, 19);
  assert.equal(f.state.audits.length, 1);
  await f.request('/report', 'POST', { ...report, state: 'installed', versionCode: 18 });
  await f.request('/report', 'POST', { ...report, state: 'installed' });
  assert.equal(f.state.softwareStatus.versionCode, 19);
  assert.equal(f.state.softwareStatus.state, 'healthy');
  await f.request('/report', 'POST', { ...report, targetVersionCode: 20, state: 'failed', error: 'update_hash_mismatch' });
  assert.equal(f.state.softwareStatus.state, 'failed');
  assert.equal(f.state.audits.length, 2);
});

test('assignment rejects downgrade, duplicate devices, disabled releases and revoked devices', async t => {
  const f = await fixture(t, true);
  f.state.softwareStatus = { versionCode: 17 };
  await assert.rejects(assignRelease(f.db, sha, [deviceId], 'operator'), { code: 'update_not_newer' });
  f.state.softwareStatus.versionCode = 16;
  await assert.rejects(assignRelease(f.db, sha, [deviceId, deviceId], 'operator'), { code: 'invalid_update_assignment' });
  f.state.assignment.release.enabled = false;
  await assert.rejects(assignRelease(f.db, sha, [deviceId], 'operator'), { code: 'update_release_unavailable' });
  f.state.assignment.release.enabled = true;
  f.state.device.status = 'REVOKED';
  await assert.rejects(assignRelease(f.db, sha, [deviceId], 'operator'), { code: 'device_not_authorized' });
  f.state.device.status = 'AUTHORIZED';
  assert.deepEqual(await assignRelease(f.db, sha, [deviceId], 'operator'), { assigned: 1, versionCode: 17 });
  assert.equal(f.state.audits[0].action, 'UPDATE_ASSIGNED');
});

test('permanent routes are mounted before store-session authentication but after device authentication', async t => {
  const f = await fixture(t, true);
  f.state.assignment = null;
  f.state.session = null;
  const app = express();
  app.use('/api/pos', posIdentityRoutes(f.db));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/pos/updates/check`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, f.signed('/check'))).status, 200);
});

test('publication binds immutable metadata to the approved signing certificate and exact bytes', () => {
  const metadata = { packageName: 'com.volta.poslab', versionCode: 19, versionName: '0.3.16-https',
    certificateSha256: 'a'.repeat(64), title: 'Versión permanente', releaseNotes: 'Canal permanente de actualizaciones.' };
  const release = validatePublication(metadata, bytes, 'a'.repeat(64));
  assert.equal(release.sha256, sha);
  assert.equal(verifyArtifact(bytes, release), bytes);
  assert.throws(() => verifyArtifact(Buffer.alloc(bytes.length), release));
  for (const change of [{ versionCode: 1.1 }, { certificateSha256: 'b'.repeat(64) }, { releaseNotes: '' }, { sha256: 'c'.repeat(64) }]) {
    assert.throws(() => validatePublication({ ...metadata, ...change }, bytes, 'a'.repeat(64)));
  }
});

test('object storage verifies size and hash and rejects arbitrary object keys', async () => {
  const release = { sha256: sha, size: bytes.length, artifactKey: artifactId(sha) };
  let calls = 0;
  const source = { bucket: 'private-test', client: { send: async command => {
    calls++; assert.equal(command.input.Key, artifactId(sha));
    return { ContentLength: bytes.length, Body: Readable.from([bytes]) };
  } } };
  assert.deepEqual(await fetchReleaseArtifact(release, source), bytes);
  await assert.rejects(fetchReleaseArtifact({ ...release, artifactKey: '../another.apk' }, source), { code: 'update_storage_invalid' });
  assert.equal(calls, 1);
  source.client.send = async () => ({ ContentLength: bytes.length, Body: Readable.from([Buffer.alloc(bytes.length)]) });
  await assert.rejects(fetchReleaseArtifact(release, source), { code: 'update_artifact_changed' });
  source.client.send = async () => ({ ContentLength: bytes.length, Body: Readable.from([bytes, Buffer.from('extra')]) });
  await assert.rejects(fetchReleaseArtifact(release, source), { code: 'update_artifact_changed' });
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
test('release authorization never requires closing the store or clearing server orders', async () => {
  const { db, state } = database();
  const assignment = { maintenanceUntil: deadline() };
  assert.equal((await maintenanceContext(db, deviceId, assignment)).storeId, 2);
  assert.equal(await maintenanceContext(db, deviceId, {}), null);
  assert.equal(await maintenanceContext(db, deviceId, { maintenanceUntil: new Date(0).toISOString() }), null);
  assert.equal(await maintenanceContext(db, deviceId, { maintenanceUntil: new Date(Date.now() + 25 * 3600_000).toISOString() }), null);
  state.session.store.active = true;
  assert.equal((await maintenanceContext(db, deviceId, assignment)).storeId, 2);
  state.session.store.active = false; state.orders = 1;
  db.sale.count = async () => { throw Error('The update must not gate on durable server orders'); };
  assert.equal((await maintenanceContext(db, deviceId, assignment)).storeId, 2);
  state.session = null;
  assert.deepEqual(await maintenanceContext(db, deviceId, assignment), { storeId: null, sessionId: null });
});
test('prepare rechecks target and store scope while allowing open stores and new orders', async t => {
  const f = await fixture(t);
  const payload = { sha256: sha, storeId: 2 };
  const permission = await f.request('/prepare', 'POST', payload);
  assert.equal(permission.status, 200);
  const permit = await permission.json();
  assert.ok(permit.validForMs > 0 && permit.validForMs <= 10000);
  assert.equal((await f.request('/prepare', 'POST', { ...payload, storeId: 1 })).status, 409);
  assert.equal((await f.request('/prepare', 'POST', { ...payload, sha256: 'b'.repeat(64) })).status, 409);
  f.state.orders = 1;
  f.state.session.store.active = true;
  assert.equal((await f.request('/prepare', 'POST', payload)).status, 200);
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
    const release = { packageName: 'com.volta.poslab', size: 10, versionCode: 17, certificateSha256: 'a'.repeat(64), apkPath: 'local.apk', versionName: 'v', title: 'Novedades', releaseNotes: 'Detalles', ...change };
    assert.throws(() => selectedRelease({ devices: { [deviceId]: { sha256: sha } }, releases: { [sha]: release } }, deviceId), { code: 'update_release_invalid' });
  }
});

test('release notes are required, bounded and available while store is open', async t => {
  const f = await fixture(t);
  f.state.session.store.active = true;
  const result = await (await f.request('/check')).json();
  assert.equal(result.maintenance.storeId, 2);
  assert.equal(result.target.title, 'Actualizaciones con tu autorización');
  for (const notes of ['', '   ', 'x'.repeat(6001), { html: 'invalid' }]) {
    f.catalogue.releases[sha].releaseNotes = notes; await f.save();
    assert.equal((await f.request('/check')).status, 503);
  }
});
