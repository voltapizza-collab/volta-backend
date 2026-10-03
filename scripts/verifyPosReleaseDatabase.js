// Integration test against an EMPTY, explicitly named local database only.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assignRelease, databaseRelease, recordSoftwareReport } from '../services/posReleaseRegistry.js';

const url = new URL(process.env.POS_TEST_DATABASE_URL || 'http://missing');
if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || url.pathname !== '/pos_updates_test')
  throw Error('Set POS_TEST_DATABASE_URL to an empty local pos_updates_test database');
const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'volta-pos-schema-'));
try {
  const tables = await prisma.$queryRawUnsafe('SHOW TABLES');
  assert.equal(tables.length, 0, 'Integration test requires an empty database');
  const schema = (await fs.readFile('prisma/schema.prisma', 'utf8'))
    .replace(/^  updateAssignment PosUpdateAssignment\?\r?\n/m, '')
    .replace(/^  softwareStatus PosSoftwareStatus\?\r?\n/m, '')
    .replace(/model (PosSoftwareRelease|PosUpdateAssignment|PosSoftwareStatus) \{[^}]+\}\r?\n/g, '');
  const baseline = path.join(directory, 'baseline.prisma');
  await fs.writeFile(baseline, schema);
  const diff = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', baseline, '--script'], { encoding: 'utf8', windowsHide: true });
  assert.equal(diff.status, 0, diff.stderr);
  const apply = async sql => {
    for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
  };
  await apply(diff.stdout);
  await apply(await fs.readFile('prisma/migrations/20261003120000_add_pos_software_releases/migration.sql', 'utf8'));
  const deviceId = crypto.randomUUID();
  await prisma.posDevice.create({ data: { id: deviceId, name: 'Local integration', model: 'TEST', publicKey: 'test', publicKeyHash: 'a'.repeat(64) } });
  const release = { sha256: 'b'.repeat(64), packageName: 'com.volta.poslab', versionCode: 19, versionName: '0.3.16-https',
    size: 123, certificateSha256: 'c'.repeat(64), artifactKey: 'pos/releases/' + 'b'.repeat(64) + '.apk',
    title: 'Integration', releaseNotes: 'Integration', publishedBy: 'test' };
  await prisma.posSoftwareRelease.create({ data: release });
  await assert.rejects(prisma.posSoftwareRelease.create({ data: { ...release, sha256: 'd'.repeat(64) } }), { code: 'P2002' });
  // The whole batch rolls back if even one device is unknown.
  await assert.rejects(assignRelease(prisma, release.sha256, [deviceId, 'ffffffff-ffff-ffff-ffff-ffffffffffff'], 'test'));
  assert.equal(await prisma.posUpdateAssignment.count(), 0);
  assert.equal(await prisma.posDeviceAudit.count(), 0);
  await assignRelease(prisma, release.sha256, [deviceId], 'test');
  assert.equal((await databaseRelease(prisma, deviceId)).release.versionCode, 19);
  const report = { state: 'healthy', versionCode: 19, targetVersionCode: 19, error: null,
    foreground: true, printerReady: true, storeId: null };
  await Promise.all([recordSoftwareReport(prisma, deviceId, report), recordSoftwareReport(prisma, deviceId, report)]);
  assert.equal(await prisma.posDeviceAudit.count({ where: { action: 'SOFTWARE_UPDATE' } }), 1);
  await recordSoftwareReport(prisma, deviceId, { ...report, versionCode: 18, state: 'installed' });
  assert.equal((await prisma.posSoftwareStatus.findUnique({ where: { deviceId } })).versionCode, 19);
  await prisma.$disconnect();
  assert.equal((await databaseRelease(prisma, deviceId)).release.sha256, release.sha256, 'Registry must survive reconnect');
  await prisma.posSoftwareRelease.update({ where: { sha256: release.sha256 }, data: { enabled: false } });
  assert.equal(await databaseRelease(prisma, deviceId), null);
  console.log('PASS: real MySQL migration, unique versions, atomic assignment rollback, concurrent reports, reconnect persistence, withdrawal');
} finally {
  await prisma.$disconnect();
  await fs.rm(directory, { recursive: true, force: true });
}
