import test from 'node:test';
import assert from 'node:assert/strict';
import { posDailySummary } from '../services/posDailySummary.js';
const from = new Date('2026-10-28T00:00:00Z'), to = new Date('2026-10-29T00:00:00Z');
const scope = { partnerId: 7, storeId: 2, processed: true, status: 'PAID' };
test('daily tickets are bounded, ordered deterministically and keep full-day totals', async () => {
  let query, aggregate;
  const db = { sale: { findMany: async args => { query = args; return Array.from({ length: 51 }, (_, i) => ({ id: 100 - i, date: from })); }, aggregate: async args => { aggregate = args; return { _count: { _all: 180 }, _sum: { total: 5000 } }; } } };
  const options = { where: scope, from, to, formatSale: x => x };
  const result = await posDailySummary(db, options);
  assert.equal(result.orders.length, 50); assert.equal(query.take, 51); assert.deepEqual(result.kpis, { ordersCount: 180, revenue: 5000 });
  assert.deepEqual(aggregate.where, { ...scope, date: { gte: from, lt: to } });
  await posDailySummary(db, { ...options, cursor: result.nextCursor });
  assert.deepEqual(query.where.AND[0], aggregate.where);
  assert.deepEqual(query.where.AND[1].OR[1], { date: from, id: { lt: 51 } });
});
test('bad and previous-day cursors fail before querying the database', async () => {
  for (const cursor of ['bad', 'x'.repeat(301), Buffer.from(JSON.stringify({ id: 1, date: from, from: to.toISOString() })).toString('base64url')]) {
    await assert.rejects(posDailySummary({}, { where: scope, from, to, cursor, formatSale: x => x }), { status: 400 });
  }
});
