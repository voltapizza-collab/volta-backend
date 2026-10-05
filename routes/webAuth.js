import express from 'express';
import { createAuthLimiter, issueWebSession, readWebSession, revokeWebSession, verifyWebPassword } from '../services/webSessions.js';

export default function webAuthRoutes(db) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/admin-login', createAuthLimiter(), async (req, res) => {
    const hash = process.env.VOLTA_ADMIN_PASSWORD_HASH;
    const username = process.env.VOLTA_ADMIN_USERNAME;
    if (!hash || !username) return res.status(503).json({ error: 'admin_access_not_configured' });
    const password = String(req.body?.password || '');
    if (req.body?.username !== username || password.length > 1024 || !verifyWebPassword(password, hash)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    return res.json(await issueWebSession(db, { role: 'global_admin' }, hash));
  });
  router.get('/session', async (req, res) => {
    const session = await readWebSession(db, req.get('authorization'));
    if (!session) return res.status(401).json({ error: 'session_expired' });
    if ((req.query.partnerSlug && req.query.partnerSlug !== session.partnerSlug) ||
        (req.query.storeSlug && req.query.storeSlug !== session.storeSlug) ||
        (req.query.role && req.query.role !== session.role)) return res.status(403).json({ error: 'business_mismatch' });
    return res.json(session);
  });
  router.delete('/session', async (req, res) => {
    await revokeWebSession(db, req.get('authorization'));
    return res.json({ ok: true });
  });
  router.use((error, _req, res, _next) => {
    console.error('[web-auth]', error.code || error.name);
    res.status(503).json({ error: 'authentication_unavailable' });
  });
  return router;
}
