import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { canonicalRequest, digest, parseDeviceKey, verifyDeviceProof, requireStoreSession,
  authenticateDevice, loginStore, logoutStore, setDeviceStatus, enrollDevice, verifyPin } from '../services/posIdentity.js';
import { hashSecret } from '../services/posCredentials.js';
import posIdentityRoutes from '../routes/posIdentity.js';

const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const id = crypto.randomUUID();
function request(overrides = {}) {
  const data = { deviceId: id, timestamp: String(Math.floor(Date.now()/1000)), nonce: crypto.randomBytes(24).toString('base64url'),
    method: 'POST', path: '/api/pos/session', body: '{"pin":"123456"}', authorization: '', ...overrides };
  const headers = { 'x-volta-device': data.deviceId, 'x-volta-time': data.timestamp, 'x-volta-nonce': data.nonce,
    authorization: data.authorization, 'x-volta-signature': crypto.sign('sha256', Buffer.from(canonicalRequest(data)), pair.privateKey).toString('base64') };
  return { method: data.method, originalUrl: data.path, rawBody: data.body, get: key => headers[key], headers };
}
test('P-256 request signatures interoperate using DER and SHA256', () => {
  const req = request();
  assert.equal(verifyDeviceProof(req, parseDeviceKey(publicKey), id), req.headers['x-volta-nonce']);
});
for (const field of ['rawBody', 'originalUrl', 'method']) test(`signature rejects changed ${field}`, () => {
  const req = request(); req[field] += 'tampered';
  assert.throws(() => verifyDeviceProof(req, pair.publicKey, id), { code: 'invalid_device_proof' });
});
test('signature binds session token and device identity', () => {
  const req = request(); req.headers.authorization = 'Bearer stolen';
  assert.throws(() => verifyDeviceProof(req, pair.publicKey, id));
  assert.throws(() => verifyDeviceProof(request(), pair.publicKey, crypto.randomUUID()));
});
test('expired and future request timestamps are rejected', () => {
  for (const delta of [-121, 121]) {
    const req = request({ timestamp: String(Math.floor(Date.now()/1000)+delta) });
    assert.throws(() => verifyDeviceProof(req, pair.publicKey, id), { code: 'invalid_device_proof' });
  }
});
test('registration rejects non-P256 and malformed keys', () => {
  assert.throws(() => parseDeviceKey('invalid'));
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => parseDeviceKey(rsa.publicKey.export({ format:'der', type:'spki' }).toString('base64')));
});
test('PIN verifier accepts existing scrypt storage without reversible PIN access', async () => {
  const hash = hashSecret('123456');
  assert.equal(await verifyPin('123456', hash), true);
  assert.equal(await verifyPin('654321', hash), false);
  assert.equal(await verifyPin('123456', 'scrypt:bad:bad'), false);
});
const token = crypto.randomBytes(32).toString('base64url');
function fixtureSession() {
  return { deviceId: id, tokenHash: digest(token), expiresAt: new Date(Date.now()+10000), partnerId: 1, storeId: 2,
    credentialFingerprint: digest('stored-hash'), device: { status:'AUTHORIZED' },
    store: { id:2, partnerId:1, active:false, posCredentialsEnabled:true, posPinHash:'stored-hash', partner:{active:true} } };
}
test('session is device-bound and a closed store can still authenticate', async () => {
  const session = fixtureSession();
  const prisma = { posSession: { findUnique: async ({where}) => where.deviceId === id ? session : null } };
  assert.equal((await requireStoreSession(prisma, id, `Bearer ${token}`)).storeId, 2);
  await assert.rejects(requireStoreSession(prisma, 'another-device', `Bearer ${token}`), { code:'session_expired' });
  await assert.rejects(requireStoreSession(prisma, id, `Bearer ${'a'.repeat(43)}`));
});
test('revocation, expiration, PIN rotation, disabled credentials and inactive brand invalidate sessions', async () => {
  for (const change of [s=>s.device.status='SUSPENDED',s=>s.expiresAt=new Date(0),s=>s.store.posPinHash='rotated',
    s=>s.store.posCredentialsEnabled=false,s=>s.store.partner.active=false,s=>s.store.partnerId=99]) {
    const session = fixtureSession(); change(session);
    await assert.rejects(requireStoreSession({posSession:{findUnique:async()=>session}},id,`Bearer ${token}`), {code:'session_expired'});
  }
});
function deviceRepo() {
  const state = { device: {id,name:'Test',model:'V3',status:'AUTHORIZED',publicKey}, nonces:new Set(), session:null, audits:[] };
  const db = {
    $queryRawUnsafe:async()=>[],
    posDevice:{findUnique:async()=>state.device,update:async({data})=>Object.assign(state.device,data)},
    posDeviceNonce:{findUnique:async({where})=>state.nonces.has(where.deviceId_nonce.nonce)?{}:null,
      create:async({data})=>{if(state.nonces.has(data.nonce))throw Object.assign(new Error('duplicate'),{code:'P2002'});state.nonces.add(data.nonce);},deleteMany:async()=>{}},
    posSession:{findUnique:async()=>state.session,deleteMany:async()=>{state.session=null;},create:async({data})=>{state.session=data;}},
    posDeviceAudit:{create:async({data})=>state.audits.push(data)},
    posLoginThrottle:{deleteMany:async()=>{},upsert:async()=>({attempts:1})},
  };
  db.$transaction=async fn=>fn(db);
  return {db,state};
}
test('used request nonce cannot execute twice',async()=>{
  const {db}=deviceRepo(); const req=request();
  await authenticateDevice(db,req);
  await assert.rejects(authenticateDevice(db,req),{code:'request_replayed'});
});
test('suspension removes session, and revoked devices cannot be reactivated',async()=>{
  const {db,state}=deviceRepo(); state.session={};
  await setDeviceStatus(db,id,'SUSPENDED','test-operator','test');
  assert.equal(state.session,null);
  await assert.rejects(authenticateDevice(db,request()),{code:'device_not_authorized'});
  await setDeviceStatus(db,id,'AUTHORIZED','test-operator','test');
  await setDeviceStatus(db,id,'REVOKED','test-operator','test');
  await assert.rejects(setDeviceStatus(db,id,'AUTHORIZED','test-operator','test'),{code:'revocation_is_permanent'});
});
test('store switching requires logout and replaces the old token',async()=>{
  const {db,state}=deviceRepo(); const hash=hashSecret('123456');
  db.$queryRawUnsafe=async sql=>sql.includes('FROM Store')?[{id:2,partnerId:1,slug:'a',posPinHash:hash}]:[];
  db.store={findUnique:async()=>({id:2,partnerId:1,posPinHash:hash,posCredentialsEnabled:true,partner:{active:true}})};
  const first=await loginStore(db,id,{username:'Brand',pin:'123456'});
  assert.equal(state.session.storeId,2);
  assert.equal(state.device.storeId,undefined);
  await assert.rejects(loginStore(db,id,{username:'Brand',pin:'123456'}),{code:'logout_required'});
  await logoutStore(db,id);
  const second=await loginStore(db,id,{username:'Brand',pin:'123456'});
  assert.notEqual(first.token,second.token);
  assert.equal(state.session.tokenHash,digest(second.token));
});
test('ambiguous credentials do not silently choose the first store',async()=>{
  const {db}=deviceRepo(); const hash=hashSecret('123456');
  db.$queryRawUnsafe=async()=>[{id:1,slug:'a',posPinHash:hash},{id:2,slug:'b',posPinHash:hash}];
  await assert.rejects(loginStore(db,id,{username:'Brand',pin:'123456'}),{code:'ambiguous_credentials'});
  await assert.rejects(loginStore(db,id,{username:'Brand',pin:'123456',storeSlug:'override'}),{code:'ambiguous_credentials'});
});
test('persistent throttle rejects excess login attempts before checking PINs',async()=>{
  const {db}=deviceRepo(); db.posLoginThrottle.upsert=async()=>({attempts:21});
  await assert.rejects(loginStore(db,id,{username:'Brand',pin:'123456'}),{code:'login_rate_limited'});
});
test('consumed enrollment cannot register a second device',async()=>{
  const req=request({deviceId:'enroll'}); req.body={code:token,publicKey,model:'V3'};
  const db={posEnrollment:{findUnique:async()=>({id:'one'}),updateMany:async()=>({count:0})}};
  db.$transaction=fn=>fn(db);
  await assert.rejects(enrollDevice(db,req),{code:'invalid_enrollment'});
});
test('HTTP router rejects anonymous requests and enforces server-side store scope',async(t)=>{
  const {db,state}=deviceRepo(); const session=fixtureSession(); state.session=session;
  let query;
  db.sale={findMany:async args=>{query=args;return[];}};
  const app=express();
  app.use(express.json({verify:(req,_res,buf)=>{req.rawBody=buf.toString('utf8');}}));
  app.use('/api/pos',posIdentityRoutes(db));
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/pos/orders')).status,401);
  for (const path of ['/api/pos/orders?storeId=99','/api/pos/orders']) {
    const req=request({method:'GET',path,body:'',authorization:`Bearer ${token}`});
    const response=await fetch(base+path,{headers:req.headers});
    assert.equal(response.status,path.includes('?')?400:200);
  }
  assert.equal(query.where.storeId,2); assert.equal(query.where.partnerId,1);
});
