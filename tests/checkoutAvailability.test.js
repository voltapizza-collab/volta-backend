import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCheckoutAvailability } from '../services/checkoutAvailability.js';

const line = { cartLineId: 'dish-1', name: 'Pizza', pizzaId: 1, size: 'M' };
const product = id => ({ id, status: 'ACTIVE', type: 'SELLABLE', selectSize: ['M'], stocks: [{ active: true }], ingredients: [{ ingredientId: id + 10 }] });
const ingredient = id => ({ id, status: 'ACTIVE', storeStocks: [{ active: true }] });
function database({ products = [product(1), product(2)], ingredients = [ingredient(11), ingredient(12), ingredient(20)] } = {}) {
  const locks = [];
  return { locks, $queryRawUnsafe: async (...args) => { locks.push(args); return []; },
    menuPizza: { findMany: async ({ where }) => { assert.equal(where.partnerId, 7); return products.filter(row => where.id.in.includes(row.id)); } },
    ingredient: { findMany: async ({ where, select }) => { assert.equal(select.storeStocks.where.storeId, 3); return ingredients.filter(row => where.id.in.includes(row.id)); } },
  };
}
const validate = (db, lines = [line]) => validateCheckoutAvailability(db, lines, 7, 3);

test('valid cart locks products, recipes and store-specific ingredients until sale commit', async () => {
  const db = database();
  await validate(db, [line, { type: 'COUPON' }, { source: 'queue_boost' }]);
  assert.equal(db.locks.length, 5);
  assert.ok(db.locks.every(([sql]) => sql.endsWith('FOR UPDATE')));
  assert.deepEqual(db.locks.find(([sql]) => sql.includes('FROM StoreIngredientStock')).slice(1), [3, 11]);
});
for (const [name, patch] of Object.entries({ inactive: { status: 'INACTIVE' }, storeOff: { stocks: [{ active: false }] }, missingStock: { stocks: [] }, wrongSize: { selectSize: ['L'] }, future: { launchAt: new Date('2099-01-01') }, expired: { availableUntil: new Date('2000-01-01') }, base: { type: 'BASE' } })) {
  test(`rejects ${name} product`, async () => {
    await assert.rejects(validate(database({ products: [{ ...product(1), ...patch }] })), { status: 409, message: 'cart_item_unavailable' });
  });
}
for (const [name, patch] of Object.entries({ globallyOff: { status: 'INACTIVE' }, storeOff: { storeStocks: [{ active: false }] }, missingStock: { storeStocks: [] } })) {
  test(`rejects ${name} recipe ingredient even when the cart removes it`, async () => {
    await assert.rejects(validate(database({ ingredients: [{ ...ingredient(11), ...patch }] }), [{ ...line, removedIngredients: [{ ingredientId: 11 }] }]), error => error.details.ingredientId === 11);
  });
}
for (const [name, changes] of Object.entries({
  extra: { extras: [{ ingredientId: 20 }] }, custom: { type: 'CUSTOM_BUILD', ingredients: [{ id: 20 }] },
  customDetails: { customDetails: { ingredients: [{ ingredientId: 20 }] } }, half: { rightPizzaId: 2 },
  reward: { source: 'incentive_reward', rewardPizzaId: 2 }, promo: { promoItems: [{ pizzaId: 2, size: 'M' }] },
  forgedFinancialSource: { source: 'coupon', extras: [{ ingredientId: 20 }] },
})) {
  test(`rejects disabled component in ${name} and accepts it after reactivation`, async () => {
    const cart = [{ ...line, ...changes }];
    await validate(database(), cart);
    await assert.rejects(validate(database({ ingredients: [ingredient(11), { ...ingredient(12), storeStocks: [] }, { ...ingredient(20), status: 'INACTIVE' }] }), cart), error => error.status === 409 && error.details.cartLineId === line.cartLineId);
  });
}
test('missing, foreign or malformed food references never bypass validation', async () => {
  for (const cart of [[{ ...line, pizzaId: 999 }], [{ ...line, pizzaId: null }], [{ ...line, extras: [{}] }], [{ type: 'PROMO', promoItems: [{}] }], [{ type: 'COUPON' }]]) {
    await assert.rejects(validate(database(), cart), { status: 409 });
  }
});

test('custom category sample is a reference, not an inherited recipe or size list', async () => {
  await validate(database({ ingredients: [ingredient(20)] }), [{ ...line, type: 'CUSTOM_BUILD', size: 'L', ingredients: [{ id: 20 }] }]);
  await assert.rejects(validate(database(), [{ ...line, type: 'CUSTOM_BUILD', ingredients: [] }]), { status: 409 });
});
