import { audit, fail, lockDevice } from './posIdentity.js';

export function releaseMetadata(release) {
  return Object.fromEntries(['sha256', 'packageName', 'versionCode', 'versionName', 'size',
    'certificateSha256', 'title', 'releaseNotes'].map(key => [key, release[key]]));
}

export async function databaseRelease(prisma, deviceId) {
  const assignment = await prisma.posUpdateAssignment.findUnique({ where: { deviceId }, include: { release: true } });
  if (!assignment?.release.enabled) return null;
  // Publication remains available until explicitly withdrawn. The short install
  // permit is freshly issued on each check, independent of the operator's consent.
  return { assignment: { maintenanceUntil: new Date(Date.now() + 3600_000).toISOString() }, release: assignment.release };
}

export async function recordSoftwareReport(prisma, deviceId, details) {
  await prisma.$transaction(async tx => {
    await lockDevice(tx, deviceId);
    const previous = await tx.posSoftwareStatus.findUnique({ where: { deviceId } });
    // A delayed receiver report must never make an installed terminal look older.
    if (previous?.versionCode > details.versionCode) return;
    if (previous?.versionCode === details.versionCode && previous?.state === 'healthy' &&
        details.state === 'installed' && previous?.targetVersionCode === details.targetVersionCode) return;
    const data = { versionCode: details.versionCode, targetVersionCode: details.targetVersionCode,
      state: details.state, error: details.error, details, lastReportAt: new Date() };
    await tx.posSoftwareStatus.upsert({ where: { deviceId }, create: { deviceId, ...data }, update: data });
    if (previous?.versionCode !== details.versionCode || previous?.state !== details.state ||
        previous?.targetVersionCode !== details.targetVersionCode || previous?.error !== details.error) {
      await audit(tx, deviceId, 'SOFTWARE_UPDATE', 'device', details);
    }
  }, { maxWait: 15000, timeout: 30000 });
}

export async function assignRelease(prisma, sha256, deviceIds, actor) {
  if (!actor || actor.length > 120 || !Array.isArray(deviceIds) || deviceIds.length < 1 || deviceIds.length > 100 ||
      new Set(deviceIds).size !== deviceIds.length) throw fail(400, 'invalid_update_assignment');
  return prisma.$transaction(async tx => {
    const release = await tx.posSoftwareRelease.findUnique({ where: { sha256 } });
    if (!release?.enabled) throw fail(409, 'update_release_unavailable');
    for (const deviceId of [...deviceIds].sort()) {
      await lockDevice(tx, deviceId);
      const status = await tx.posSoftwareStatus.findUnique({ where: { deviceId } });
      if (status?.versionCode >= release.versionCode) throw fail(409, 'update_not_newer');
      const data = { releaseSha256: sha256, assignedBy: actor, assignedAt: new Date() };
      await tx.posUpdateAssignment.upsert({ where: { deviceId }, create: { deviceId, ...data }, update: data });
      await audit(tx, deviceId, 'UPDATE_ASSIGNED', actor, { sha256, versionCode: release.versionCode });
    }
    return { assigned: deviceIds.length, versionCode: release.versionCode };
  }, { maxWait: 15000, timeout: 30000 });
}
