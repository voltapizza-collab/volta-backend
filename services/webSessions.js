import crypto from 'node:crypto';

const schemas = new WeakMap();
export const tokenHash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export const backofficeCredential = partner => partner.backofficePasswordHash || `initial:${partner.slug}`;
export function hashWebPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}
export function verifyWebPassword(password, stored) {
  const [algorithm, salt, hash] = String(stored || '').split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

// Matches the existing additive schema preparation used by partner settings.
// Deployment can provision the same table ahead of time; no credentials are stored in clear text.
export async function ensureWebSessions(db) {
  if (!schemas.has(db)) schemas.set(db, db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS WebSession (
    tokenHash CHAR(64) PRIMARY KEY, role VARCHAR(24) NOT NULL,
    partnerId INT NULL, storeId INT NULL, credentialHash CHAR(64) NOT NULL,
    expiresAt DATETIME(3) NOT NULL, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX WebSession_partner (partnerId), INDEX WebSession_expiry (expiresAt)
  )`).catch(error => { schemas.delete(db); throw error; }));
  return schemas.get(db);
}

export async function issueWebSession(db, identity, credential) {
  await ensureWebSessions(db);
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const days = identity.role === 'backoffice' && identity.rememberDevice ? 90 : identity.role === 'pos' ? 7 : 1;
  const expiresAt = new Date(Date.now() + days * 86400000);
  await db.$executeRawUnsafe(`INSERT INTO WebSession
    (tokenHash, role, partnerId, storeId, credentialHash, expiresAt) VALUES (?, ?, ?, ?, ?, ?)`,
  tokenHash(sessionToken), identity.role, identity.partnerId || null, identity.storeId || null, tokenHash(credential), expiresAt);
  return { ...identity, sessionToken, expiresAt: expiresAt.toISOString() };
}

export async function readWebSession(db, authorization) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(String(authorization || ''))?.[1];
  if (!token) return null;
  await ensureWebSessions(db);
  const rows = await db.$queryRawUnsafe('SELECT * FROM WebSession WHERE tokenHash = ? AND expiresAt > NOW() LIMIT 1', tokenHash(token));
  const row = rows?.[0];
  if (!row) return null;
  if (row.role === 'global_admin') {
    const hash = process.env.VOLTA_ADMIN_PASSWORD_HASH;
    return hash && row.credentialHash === tokenHash(hash) ? { role: row.role, expiresAt: row.expiresAt } : null;
  }
  const partners = await db.$queryRawUnsafe('SELECT id, name, slug, active, backofficePasswordHash FROM Partner WHERE id = ? LIMIT 1', Number(row.partnerId));
  const partner = partners?.[0];
  if (!partner || !partner.active) return null;
  const store = row.storeId ? await db.store.findFirst({ where: { id: Number(row.storeId), partnerId: Number(partner.id) } }) : null;
  if (row.role === 'pos' && (!store || store.posCredentialsEnabled === false || store.posCredentialsEnabled === 0)) return null;
  const credential = row.role === 'pos' ? store.posPinHash : backofficeCredential(partner);
  if (!credential || tokenHash(credential) !== row.credentialHash) return null;
  return { role: row.role, partnerId: Number(partner.id), partnerSlug: partner.slug, partnerName: partner.name,
    storeId: store?.id || null, storeSlug: store?.slug || null, storeName: store?.storeName || null,
    rememberDevice: row.role === 'backoffice' && new Date(row.expiresAt) - new Date(row.createdAt) > 30 * 86400000,
    expiresAt: row.expiresAt, isDemo: partner.slug === 'volta-demo' };
}

export async function revokeWebSession(db, authorization) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(String(authorization || ''))?.[1];
  if (!token) return;
  await ensureWebSessions(db);
  await db.$executeRawUnsafe('DELETE FROM WebSession WHERE tokenHash = ?', tokenHash(token));
}

// Bounded per-process throttling. A reverse-proxy shared limit is required for multi-replica deployments.
export function createAuthLimiter({ max = 15, windowMs = 900000, now = Date.now } = {}) {
  const attempts = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!attempts.has(key) && attempts.size >= 10000) return res.status(429).json({ error: 'try_later' });
    const value = attempts.get(key) || { count: 0, until: time + windowMs };
    attempts.set(key, value);
    if (++value.count > max) {
      res.set('Retry-After', String(Math.ceil((value.until - time) / 1000)));
      return res.status(429).json({ error: 'try_later' });
    }
    next();
  };
}
