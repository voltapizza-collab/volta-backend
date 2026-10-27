import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import posUiRoutes from '../routes/posUi.js';
import { validateCheckoutAvailability } from '../services/checkoutAvailability.js';

async function setup(t) {
  const products = [
    { id: 10, name: 'Coca-Cola', category: 'Bebidas', partnerId: 7, status: 'ACTIVE', type: 'SELLABLE', ingredients: [] },
    { id: 11, name: 'Nuggets', category: 'Entrantes', partnerId: 7, status: 'ACTIVE', type: 'SELLABLE', ingredients: [
      { ingredientId: 50, ingredient: { id: 50, name: 'Pollo', status: 'ACTIVE', storeStocks: [{ active: false }] } },
    ] },
    { id: 12, partnerId: 8, status: 'ACTIVE', type: 'SELLABLE', ingredients: [] },
    { id: 13, partnerId: 7, status: 'INACTIVE', type: 'SELLABLE', ingredients: [] },
  ];
  const stocks = [{ storeId: 2, pizzaId: 10, active: true, stock: 4 }, { storeId: 3, pizzaId: 10, active: true, stock: 9 }, { storeId: 2, pizzaId: 11, active: false, stock: 0 }];
  let ingredientWrites = 0;
  const db = {
    store: { findUnique: async ({ where }) => where.id === 2 ? { id: 2, partnerId: 7 } : null },
    menuPizza: {
      findMany: async ({ where }) => products.filter(row => row.partnerId === where.partnerId && row.type === where.type && row.status === where.status),
      findFirst: async ({ where }) => products.find(row => Object.entries(where).every(([key, value]) => row[key] === value)),
    },
    storePizzaStock: {
      findMany: async ({ where }) => stocks.filter(row => row.storeId === where.storeId),
      upsert: async ({ where, update, create }) => {
        const row = stocks.find(item => item.storeId === where.storeId_pizzaId.storeId && item.pizzaId === where.storeId_pizzaId.pizzaId);
        if (row) { Object.assign(row, update); return row; }
        stocks.push(create); return create;
      },
    },
    storeIngredientStock: { upsert: async () => { ingredientWrites++; throw new Error('Must not write ingredient availability'); } },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.posSession = { storeId: 2, partnerId: 7 }; next(); });
  app.use(posUiRoutes(db));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = (path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, body === undefined ? {} : {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { request, stocks, ingredientWrites: () => ingredientWrites };
}

test('native POS lists complete products and blocks exhausted recipes without affecting ingredients', async t => {
  const { request, stocks, ingredientWrites } = await setup(t);
  const initial = await (await request('/api/stock/2')).json();
  assert.deepEqual(initial.map(row => row.pizzaId), [10, 11]);
  assert.equal(initial[0].available, true);
  assert.equal((await request('/api/stock/2/10/active', { active: false })).status, 200);
  assert.equal(stocks.find(row => row.storeId === 2 && row.pizzaId === 10).active, false);
  assert.equal(stocks.find(row => row.storeId === 3 && row.pizzaId === 10).active, true);
  assert.equal(stocks[0].stock, 4);
  assert.equal((await (await request('/api/stock/2')).json())[0].available, false);
  assert.equal((await request('/api/stock/2/10/active', { active: true })).status, 200);
  assert.equal((await (await request('/api/stock/2')).json())[0].available, true);
  assert.equal((await request('/api/stock/2/11/active', { active: true })).status, 200);
  const nuggets = (await (await request('/api/stock/2')).json())[1];
  assert.equal(nuggets.active, true);
  assert.equal(nuggets.available, false);
  assert.equal(nuggets.pizza.ingredients[0].active, false);
  assert.equal(nuggets.blockers[0].type, 'ingredient_inactive_in_store');
  assert.equal(ingredientWrites(), 0);
});

test('native POS rejects another store, foreign or inactive products and invalid flags', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/stock/3/10/active', { active: false })).status, 403);
  for (const id of [12, 13, 999]) assert.equal((await request(`/api/stock/2/${id}/active`, { active: true })).status, 404);
  assert.equal((await request('/api/stock/2/10/active', { active: 'false' })).status, 400);
});

test('checkout rejects a complete product without ingredients when its store switch is off', async () => {
  let active = false;
  const tx = { $queryRawUnsafe: async () => [], menuPizza: { findMany: async () => [{
    id: 10, status: 'ACTIVE', type: 'SELLABLE', selectSize: ['M'], stocks: [{ active }], ingredients: [],
  }] } };
  const cart = [{ pizzaId: 10, name: 'Coca-Cola', size: 'M', cartLineId: 'drink' }];
  await assert.rejects(validateCheckoutAvailability(tx, cart, 7, 2), error => error.status === 409 && error.details.reason === 'product_unavailable');
  active = true;
  await validateCheckoutAvailability(tx, cart, 7, 2);
});
