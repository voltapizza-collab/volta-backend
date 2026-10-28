import test from 'node:test';
import assert from 'node:assert/strict';
import { posFleetHealth } from '../services/posFleetHealth.js';
test('fleet overview scans all pages and separates stale reports from current failures', async () => {
  let calls = 0;
  const now = Date.now();
  const prisma = { posDevice: { findMany: async args => {
    assert.deepEqual(args.where, { status: 'AUTHORIZED' }); calls++;
    if (calls === 1) return Array.from({ length: 100 }, (_, id) => ({ id: String(id), softwareStatus: { versionCode: 29, state: 'healthy', lastReportAt: new Date(now) } }));
    assert.equal(args.cursor.id, '99');
    return [{ id: 'last', softwareStatus: { versionCode: 28, state: 'failed', error: 'installation_timeout', lastReportAt: new Date(now - 3600000) } }];
  } } };
  const result = await posFleetHealth(prisma, now);
  assert.equal(result.total, 101); assert.equal(result.groups[0].count, 100);
  assert.equal(result.groups[1].freshness, 'stale_or_offline'); assert.equal(calls, 2);
});
