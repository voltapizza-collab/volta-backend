import express from 'express';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fail, audit } from '../services/posIdentity.js';
import { databaseRelease, releaseMetadata, recordSoftwareReport } from '../services/posReleaseRegistry.js';
import { loadReleaseArtifact } from '../services/posReleaseStorage.js';

const shaPattern = /^[a-f0-9]{64}$/;
const states = new Set(['checking', 'downloading', 'ready', 'waiting_permission', 'waiting_safe',
  'installing', 'confirmation_required', 'installed', 'healthy', 'failed', 'idle', 'pending', 'scheduled']);

// Operator-owned catalogue. There is deliberately no public publishing endpoint.
export async function readUpdateCatalogue(file) {
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!value || value.schema !== 1 || !value.devices || !value.releases) throw fail(503, 'update_catalogue_invalid');
  return value;
}

export function selectedRelease(catalogue, deviceId) {
  const assignment = catalogue.devices[deviceId];
  if (!assignment?.sha256) return null;
  const release = catalogue.releases[assignment.sha256];
  if (!release || !shaPattern.test(assignment.sha256) || release.packageName !== 'com.volta.poslab' ||
      !Number.isSafeInteger(release.versionCode) || release.versionCode <= 0 ||
      !Number.isSafeInteger(release.size) || release.size <= 0 || release.size > 100 * 1024 * 1024 ||
      !shaPattern.test(release.certificateSha256 || '') || typeof release.apkPath !== 'string' ||
      typeof release.versionName !== 'string' || release.versionName.length > 80 ||
      typeof release.title !== 'string' || !release.title.trim() || release.title.length > 160 ||
      typeof release.releaseNotes !== 'string' || !release.releaseNotes.trim() || release.releaseNotes.length > 6000)
    throw fail(503, 'update_release_invalid');
  return { assignment, release: { ...release, sha256: assignment.sha256 } };
}

export async function maintenanceContext(prisma, deviceId, assignment, now = Date.now()) {
  const deadline = Date.parse(assignment.maintenanceUntil || '');
  if (!Number.isFinite(deadline) || deadline <= now || deadline > now + 24 * 3600_000) return null;
  const session = await prisma.posSession.findUnique({ where: { deviceId } });
  if (!session) return { storeId: null, sessionId: null };
  // Store availability and the server's durable order queue are independent
  // from replacing this terminal. The native gate drains its in-flight work.
  return { storeId: session.storeId, sessionId: session.id };
}

export default function posUpdatesRoutes(prisma, { catalogueFile, onEvent = () => {}, loadArtifact = loadReleaseArtifact } = {}) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // A file catalogue is only an explicit test adapter. Production uses the DB.
  const selection = async req => catalogueFile
    ? selectedRelease(await readUpdateCatalogue(catalogueFile), req.posDevice.id)
    : databaseRelease(prisma, req.posDevice.id);
  router.get('/check', async (req, res) => {
    const chosen = await selection(req);
    if (!catalogueFile) {
      const lastCheckAt = new Date();
      await prisma.posSoftwareStatus.upsert({ where: { deviceId: req.posDevice.id },
        create: { deviceId: req.posDevice.id, lastCheckAt }, update: { lastCheckAt } });
    }
    if (!chosen) return res.json({ target: null });
    const target = releaseMetadata(chosen.release);
    res.json({ target, maintenance: await maintenanceContext(prisma, req.posDevice.id, chosen.assignment) });
  });
  router.get('/apk/:sha', async (req, res) => {
    const chosen = await selection(req);
    if (!chosen || req.params.sha !== chosen.release.sha256) throw fail(403, 'update_not_assigned');
    // Validate the immutable artifact before opening a download. For the small
    // validation cohort this intentionally favours correctness over caching.
    if (catalogueFile && (await fs.stat(chosen.release.apkPath)).size !== chosen.release.size) throw fail(503, 'update_artifact_changed');
    const data = catalogueFile ? await fs.readFile(chosen.release.apkPath) : await loadArtifact(chosen.release);
    if (data.length !== chosen.release.size || crypto.createHash('sha256').update(data).digest('hex') !== req.params.sha)
      throw fail(503, 'update_artifact_changed');
    res.type('application/vnd.android.package-archive').set('Content-Length', String(data.length));
    res.send(data);
    onEvent({ deviceId: req.posDevice.id, event: 'apk_sent', sha256: req.params.sha, bytes: data.length });
  });
  router.post('/prepare', async (req, res) => {
    const chosen = await selection(req);
    if (!chosen || req.body?.sha256 !== chosen.release.sha256) throw fail(409, 'update_target_changed');
    const context = await maintenanceContext(prisma, req.posDevice.id, chosen.assignment);
    if (!context || req.body.storeId !== context.storeId) throw fail(409, 'update_not_safe');
    const validForMs = Math.min(10_000, Date.parse(chosen.assignment.maintenanceUntil) - Date.now());
    if (validForMs <= 0) throw fail(409, 'update_not_safe');
    res.json({ allowed: true, ...context, validForMs, expiresAt: new Date(Date.now() + validForMs).toISOString() });
  });
  router.post('/report', async (req, res) => {
    const body = req.body || {};
    if (!states.has(body.state) || !Number.isSafeInteger(body.versionCode) || body.versionCode < 1 ||
        (body.targetVersionCode != null && !Number.isSafeInteger(body.targetVersionCode)) ||
        (body.error != null && !/^[a-zA-Z0-9_:-]{1,100}$/.test(body.error)) ||
        (body.decision != null && !['now','scheduled','pending'].includes(body.decision)) ||
        (body.approvedSha && !shaPattern.test(body.approvedSha)) ||
        [body.scheduledAt,body.authorizedUntil].some(value => value != null && (!Number.isSafeInteger(value) || value < 0))) throw fail(400, 'invalid_update_report');
    const details = { state: body.state, versionCode: body.versionCode,
      targetVersionCode: body.targetVersionCode ?? null, error: body.error ?? null,
      foreground: body.foreground === true, printerReady: body.printerReady === true,
      storeId: Number.isSafeInteger(body.storeId) ? body.storeId : null,
      decision: body.decision ?? null, approvedSha: body.approvedSha || null,
      scheduledAt: body.scheduledAt ?? null, authorizedUntil: body.authorizedUntil ?? null };
    if (catalogueFile) await audit(prisma, req.posDevice.id, 'SOFTWARE_UPDATE', 'device', details);
    else await recordSoftwareReport(prisma, req.posDevice.id, details);
    onEvent({ deviceId: req.posDevice.id, event: 'report', ...details });
    res.json({ ok: true });
  });
  return router;
}
