import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import storesRoutes from '../routes/stores.js';

test('pause endpoint persists only the pause flag and rejects invalid input', async t => {
  const writes = [];
  const prisma = { store: { update: async args => {
    writes.push(args);
    return { id: 1, active: true, acceptingOrders: true, ...args.data };
  } } };
  const app = express(); app.use(express.json()); app.use(storesRoutes(prisma));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const patch = body => fetch(`http://127.0.0.1:${server.address().port}/1/operations-pause`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const paused of [true, false]) {
    const response = await patch({ paused, active: false });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.operationsPaused, paused);
    assert.equal(data.active, true);
    assert.equal(data.acceptingOrders, true);
    assert.deepEqual(writes.at(-1).data, { operationsPaused: paused });
  }
  assert.equal((await patch({ paused: 'false' })).status, 400);
  assert.equal(writes.length, 2);
});
