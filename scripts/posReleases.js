// Trusted operator CLI, using the same credentials boundary as posAdmin.js.
// Never expose database/provider credentials to a terminal or a public API.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import prisma from '../services/prisma.js';
import { audit, lockDevice } from '../services/posIdentity.js';
import { uploadReleaseArtifact, migrationDownloadUrl } from '../services/posReleaseStorage.js';
import { validatePublication, verifyApkFile } from '../services/posApkVerification.js';
import { assignRelease } from '../services/posReleaseRegistry.js';

const [command, ...args] = process.argv.slice(2);
const actorValue = value => {
  if (!value?.trim() || value.length > 120) throw Error('A named operator (max 120 characters) is required');
  return value.trim();
};
try {
  if (command === 'publish') {
    const [apkPath, metadataPath, operator] = args;
    const actor = actorValue(operator);
    const bytes = await fs.readFile(apkPath);
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    const release = validatePublication(metadata, bytes, process.env.POS_APK_CERTIFICATE_SHA256?.toLowerCase());
    // Verify a private snapshot of the bytes that will be uploaded, not a mutable
    // build output which another build could replace while signing is checked.
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'volta-apk-verify-'));
    try {
      const snapshot = path.join(directory, 'release.apk');
      await fs.writeFile(snapshot, bytes, { flag: 'wx', mode: 0o600 });
      verifyApkFile(snapshot, release, { buildTools: process.env.ANDROID_BUILD_TOOLS,
        java: process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java' });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
    const existing = await prisma.posSoftwareRelease.findUnique({ where: { versionCode: release.versionCode } });
    if (existing) {
      if (Object.entries(release).some(([key, value]) => existing[key] !== value)) throw Error('Version already published with different bytes or metadata; increment versionCode');
      console.log(JSON.stringify({ sha256: existing.sha256, versionCode: existing.versionCode, alreadyPublished: true, enabled: existing.enabled }));
    } else {
      const artifact = await uploadReleaseArtifact(bytes, release.sha256);
      const row = await prisma.posSoftwareRelease.create({ data: { ...release, ...artifact, publishedBy: actor } });
      console.log(JSON.stringify({ sha256: row.sha256, versionCode: row.versionCode, published: true, assigned: false }));
    }
  } else if (command === 'migration-link') {
    const [sha256, outputFile, operator] = args;
    actorValue(operator);
    const release = await prisma.posSoftwareRelease.findUnique({ where: { sha256 } });
    if (!release?.enabled || !outputFile) throw Error('An enabled release and a new private output file are required');
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const url = await migrationDownloadUrl(release);
    await fs.writeFile(outputFile, JSON.stringify({ versionName: release.versionName, sha256,
      expiresAt: new Date(expiresAt * 1000).toISOString(), url }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log('One-hour migration download link saved. Open it in the terminal browser and approve the Android update; do not uninstall Volta.');
  } else if (command === 'assign') {
    const [sha256, operator, ...deviceIds] = args;
    console.log(JSON.stringify(await assignRelease(prisma, sha256, deviceIds, actorValue(operator))));
  } else if (command === 'unassign') {
    const [deviceId, operator] = args; const actor = actorValue(operator);
    await prisma.$transaction(async tx => {
      await lockDevice(tx, deviceId);
      await tx.posUpdateAssignment.deleteMany({ where: { deviceId } });
      await audit(tx, deviceId, 'UPDATE_WITHDRAWN', actor);
    });
    console.log('Assignment withdrawn. Installed software is preserved.');
  } else if (command === 'withdraw') {
    const [sha256, operator] = args; const actor = actorValue(operator);
    await prisma.$transaction(async tx => {
      await tx.posSoftwareRelease.update({ where: { sha256 }, data: { enabled: false } });
      const assignments = await tx.posUpdateAssignment.findMany({ where: { releaseSha256: sha256 } });
      for (const row of assignments) await audit(tx, row.deviceId, 'RELEASE_WITHDRAWN', actor, { sha256 });
    }, { maxWait: 15000, timeout: 30000 });
    console.log('Release withdrawn from all terminals. Installed software is preserved.');
  } else if (command === 'list') {
    console.log(JSON.stringify(await prisma.posSoftwareRelease.findMany({ select: { sha256: true, versionCode: true,
      versionName: true, title: true, enabled: true, createdAt: true, publishedBy: true, _count: { select: { assignments: true } } },
    orderBy: { versionCode: 'desc' }, take: 100 }), null, 2));
  } else if (command === 'status') {
    console.log(JSON.stringify(await prisma.posDevice.findMany({ select: { id: true, name: true, status: true,
      softwareStatus: true, updateAssignment: { select: { releaseSha256: true, assignedAt: true } } },
    orderBy: { id: 'asc' }, take: 100, ...(args[0] ? { cursor: { id: args[0] }, skip: 1 } : {}) }), null, 2));
  } else throw Error('Commands: publish APK METADATA_JSON ACTOR | migration-link SHA PRIVATE_OUTPUT_JSON ACTOR | assign SHA ACTOR DEVICE_ID... | unassign DEVICE_ID ACTOR | withdraw SHA ACTOR | list | status [CURSOR_DEVICE_ID]');
} catch (error) {
  // Provider errors may contain authenticated URLs; never dump their raw payload.
  console.error(error.status ? error.code : error instanceof Error ? error.message : 'Release operation failed');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
