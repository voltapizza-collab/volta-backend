import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueuePosEffect, processPosOutbox, saveIngredientWithEffects, completeOrderWithEffects } from '../services/posOutbox.js';
test('enqueue uses its supplied transaction and propagates failures for rollback', async () => {
  let parameters;
  const tx = { $executeRawUnsafe: async (...args) => { parameters = args; } };
  await enqueuePosEffect(tx, 'ORDER_READY', { saleId: 2 }, 'order-ready:2');
  assert.deepEqual(parameters.slice(1), ['order-ready:2', 'ORDER_READY', '{"saleId":2}', 'PENDING']);
  tx.$executeRawUnsafe = async () => { throw new Error('DB unavailable'); };
  await assert.rejects(enqueuePosEffect(tx, 'ORDER_READY', {}), /DB unavailable/);
});
test('order completion and both effects commit together; failure rolls the order back', async () => {
  let state = { processed: false, effects: [] }, fail = true;
  const db = { $transaction: async run => {
    const next = structuredClone(state);
    const tx = { sale: { updateMany: async () => { if (next.processed) return { count: 0 }; next.processed = true; return { count: 1 }; } },
      $executeRawUnsafe: async (_sql, id) => { if (fail) throw Error('outbox unavailable'); next.effects.push(id); } };
    const result = await run(tx); state = next; return result;
  } };
  await assert.rejects(completeOrderWithEffects(db, 9, async () => ({ id: 9 })), /outbox unavailable/);
  assert.equal(state.processed, false); assert.deepEqual(state.effects, []);
  fail = false; await completeOrderWithEffects(db, 9, async () => ({ id: 9 }));
  assert.equal(state.processed, true); assert.deepEqual(state.effects, ['order-ready:9','order-review:9']);
  await assert.rejects(completeOrderWithEffects(db, 9, async () => ({})), { status: 409 });
  assert.equal(state.effects.length, 2);
});
test('ingredient event uses locked current state, not an earlier stale read', async () => {
  let active = true, effects = 0;
  const tx = { $queryRawUnsafe: async sql => { assert.match(sql, /FOR UPDATE/); return [{ active }]; }, $executeRawUnsafe: async () => { effects++; } };
  const db = { $transaction: run => run(tx) };
  const options = { storeId: 1, ingredientId: 2, notify: true, active: false, saveStock: async () => { active = false; return { active }; } };
  assert.equal((await saveIngredientWithEffects(db, options)).queued, true);
  assert.equal((await saveIngredientWithEffects(db, options)).queued, false);
  assert.equal(effects, 1);
});
test('parallel workers claim a job once and ambiguous sends are retained for review', async () => {
  let state = 'PENDING', sends = 0;
  const db = { $queryRawUnsafe: async () => [{ id: 'job', kind: 'SMS', payload: '{}' }], $executeRawUnsafe: async (sql, ...args) => {
    if (sql.includes("SET state = 'PROCESSING'")) { if (state !== 'PENDING') return 0; state = 'PROCESSING'; return 1; }
    if (sql.includes("error = 'effect_not_confirmed'")) state = 'REVIEW';
    if (sql.includes('SET state = ?')) state = args[0];
    return 1;
  } };
  const handlers = { SMS: async () => { sends++; throw new Error('unknown provider outcome'); } };
  await Promise.all([processPosOutbox(db, handlers), processPosOutbox(db, handlers)]);
  assert.equal(sends, 1); assert.equal(state, 'REVIEW');
  await processPosOutbox(db, handlers); assert.equal(sends, 1);
});
