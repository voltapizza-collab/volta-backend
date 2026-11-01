import assert from 'node:assert/strict';
import test from 'node:test';
import { isPromoAvailable } from '../services/promoAvailability.js';

const pizza = { pizzaId: 1, name: 'Pizza', categoryId: 1, category: 'Pizzas', selectSize: ['M'], available: true };
const ravioli = { pizzaId: 2, name: 'Raviolis', categoryId: 2, category: 'Pasta', selectSize: ['U'], available: true };
const pack = { items: [{ pizzaId: 1, size: 'M' }, { pizzaId: 2, size: 'U' }] };

test('a fixed pack disappears when a component leaves the store menu and returns when restored', () => {
  assert.equal(isPromoAvailable(pack, [pizza, ravioli]), true);
  assert.equal(isPromoAvailable(pack, [pizza]), false);
  assert.equal(isPromoAvailable(pack, [pizza, { ...ravioli, available: false }]), false);
  assert.equal(isPromoAvailable(pack, [pizza, ravioli]), true);
});

test('availability is store-specific and does not substitute a different product with the same name', () => {
  assert.equal(isPromoAvailable(pack, [pizza, ravioli]), true);
  assert.equal(isPromoAvailable(pack, [pizza, { ...ravioli, pizzaId: 3 }]), false);
});

test('a removed size hides the pack even if its product remains available', () => {
  assert.equal(isPromoAvailable(pack, [pizza, { ...ravioli, selectSize: ['M'] }]), false);
});

test('choice packs need enough distinct available options in the configured size', () => {
  const choice = { items: [{ type: 'CHOICE', optionProductIds: [1, 3, 4], quantity: 2, size: 'M' }, pack.items[1]] };
  const other = { ...pizza, pizzaId: 3 };
  assert.equal(isPromoAvailable(choice, [pizza, other, ravioli]), true);
  assert.equal(isPromoAvailable(choice, [pizza, ravioli]), false);
  assert.equal(isPromoAvailable(choice, [pizza, pizza, ravioli]), false);
  assert.equal(isPromoAvailable(choice, [pizza, { ...other, selectSize: ['L'] }, ravioli]), false);
  assert.equal(isPromoAvailable(choice, [pizza, other]), false);
});

test('category choices respect category identity and support legacy category names', () => {
  assert.equal(isPromoAvailable({ items: [{ type: 'CATEGORY', categoryId: 2 }] }, [ravioli]), true);
  assert.equal(isPromoAvailable({ items: [{ type: 'CHOICE', categoryName: 'pásta' }] }, [ravioli]), true);
  assert.equal(isPromoAvailable({ items: [{ type: 'CHOICE', categoryId: 9, categoryName: 'Pasta' }] }, [ravioli]), false);
  assert.equal(isPromoAvailable({ items: [{ type: 'CHOICE', choiceType: 'PRODUCTS', optionProductIds: [], categoryId: 2 }] }, [ravioli]), false);
});

test('empty and broken packs are never advertised', () => {
  for (const items of [[], null, [null], [{ name: 'Raviolis' }]]) {
    assert.equal(isPromoAvailable({ items }, [pizza, ravioli]), false);
  }
});
