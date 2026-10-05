import crypto from 'node:crypto';
import { tokenHash } from './webSessions.js';

const schemas = new WeakMap();
export async function ensureBackofficeCredentialColumns(db) {
  if (!schemas.has(db)) schemas.set(db, (async () => {
    for (const [name, type] of [['backofficePasswordHash', 'TEXT NULL'], ['backofficeResetTokenHash', 'VARCHAR(128) NULL'], ['backofficeResetExpiresAt', 'DATETIME NULL']]) {
      try { await db.$executeRawUnsafe(`ALTER TABLE Partner ADD COLUMN ${name} ${type}`); }
      catch (error) { if (!String(error.message).includes('Duplicate column') && String(error.meta?.code) !== '1060') throw error; }
    }
  })().catch(error => { schemas.delete(db); throw error; }));
  return schemas.get(db);
}

export async function issueBackofficeInvitation(db, partnerId, partnerSlug, frontendUrl) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.$executeRawUnsafe(`UPDATE Partner SET backofficeResetTokenHash = ?, backofficeResetExpiresAt = ? WHERE id = ?`,
    tokenHash(token), expiresAt, partnerId);
  return `${frontendUrl}/backoffice/${encodeURIComponent(partnerSlug)}?reset=${token}`;
}

export function safeActivation(activation) {
  if (!activation) return activation;
  const { password, posPin, invitationUrl, ...safe } = activation;
  return { ...safe, posCredentials: (safe.posCredentials || []).map(({ pin, ...credential }) => credential) };
}
