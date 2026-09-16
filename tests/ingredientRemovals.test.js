import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import checkoutRoutes from "../routes/checkout.js";
import { validateIngredientRemovals } from "../services/ingredientRemovals.js";
import { formatSale, buildRepeatCartDraft } from "../routes/myorders.js";

const onion = { ingredientId: 10, removable: false, qtyBySize: { M: 0, L: 0 }, ingredient: { name: "Cebolla", status: "ACTIVE" } };
const pizza = { id: 1, selectSize: ["M", "L"], ingredients: [onion,
  { ingredientId: 11, ingredient: { name: "Mozzarella", status: "ACTIVE" } },
] };
const line = { cartLineId: "pizza-1", pizzaId: 1, name: "Barbacoa", size: "M", qty: 2, price: 10, subtotal: 20,
  removedIngredients: [{ ingredientId: 10, name: "FAKE INSTRUCTION" }] };
const mock = (rows = [pizza]) => ({ menuPizza: { findMany: async (query) => {
  assert.equal(query.where.partnerId, 7);
  assert.deepEqual(query.where.stocks, { some: { storeId: 3, active: true } });
  return rows;
} } });

test("canonical removals are deduplicated, remain per line and never change prices or extras", async () => {
  const customized = { ...line, removedIngredients: [...line.removedIngredients, ...line.removedIngredients], extras: [{ ingredientId: 12, price: 2 }] };
  const normal = { ...line, cartLineId: "normal", removedIngredients: [] };
  const result = await validateIngredientRemovals(mock(), [customized, normal], 7, 3);
  assert.deepEqual(result[0].removedIngredients, [{ ingredientId: 10, name: "Cebolla" }]);
  assert.equal(result[0].price, 10);
  assert.equal(result[0].subtotal, 20);
  assert.deepEqual(result[0].extras, customized.extras);
  assert.deepEqual(result[1], normal);
});

test("old orders without removals require no additional database query", async () => {
  const lines = [{ pizzaId: 1 }, { pizzaId: 2, removedIngredients: [] }];
  assert.equal(await validateIngredientRemovals({}, lines, 7, 3), lines);
});

test("recipe ingredients need no permission or positive quantities at the selected size", async () => {
  for (const size of ["M", "L"]) {
    const [result] = await validateIngredientRemovals(mock(), [{ ...line, size,
      removedIngredients: [{ ingredientId: 10 }, { ingredientId: 11 }] }], 7, 3);
    assert.deepEqual(result.removedIngredients, [{ ingredientId: 10, name: "Cebolla" }, { ingredientId: 11, name: "Mozzarella" }]);
    assert.equal(result.subtotal, line.subtotal);
  }
});

test("rejects unknown, inactive and random ingredients, invalid sizes and unavailable recipes", async () => {
  for (const changes of [{ removedIngredients: [{ ingredientId: 999 }] }, { size: "INVALID" }]) {
    await assert.rejects(validateIngredientRemovals(mock(), [{ ...line, ...changes }], 7, 3), /ingredient_removal_unavailable/);
  }
  for (const ingredient of [{ ...onion.ingredient, status: "INACTIVE" }, { ...onion.ingredient, canonicalKey: "random_selection_1" }, { ...onion.ingredient, name: "Random selection 2" }]) {
    await assert.rejects(validateIngredientRemovals(mock([{ ...pizza, ingredients: [{ ...onion, ingredient }] }]), [line], 7, 3), /ingredient_removal_unavailable/);
  }
  await assert.rejects(validateIngredientRemovals(mock([]), [line], 7, 3), /ingredient_removal_unavailable/);
});

test("rejects malformed removals, contradictions, halves, promotions, rewards and custom builds", async () => {
  for (const removedIngredients of ["Sin cebolla", {}, [null], [{ ingredientId: 0 }], Array(101).fill({ ingredientId: 10 })]) {
    await assert.rejects(validateIngredientRemovals(mock(), [{ ...line, removedIngredients }], 7, 3), /invalid_ingredient_removals/);
  }
  await assert.rejects(validateIngredientRemovals(mock(), [{ ...line, extras: [{ ingredientId: 10 }] }], 7, 3), /ingredient_removal_extra_conflict/);
  await assert.rejects(validateIngredientRemovals(mock(), [{ ...line, extras: JSON.stringify([{ ingredientId: 10 }]) }], 7, 3), /ingredient_removal_extra_conflict/);
  for (const changes of [{ type: "HALF_HALF" }, { leftPizzaId: 2 }, { promoId: 1 }, { promoItems: [{}] }, { source: "promo" }, { source: "incentive_reward" }, { type: "CUSTOM_BUILD" }, { cartLineId: "promo-1" }, { cartLineId: "half-1" }]) {
    await assert.rejects(validateIngredientRemovals({}, [{ ...line, ...changes }], 7, 3), /ingredient_removals_not_supported/);
  }
});

test("HTTP checkout saves canonical removals and rejects invalid requests before creating a sale", async (t) => {
  const saved = [];
  const store = { id: 3, partnerId: 7, active: true, acceptingOrders: true, pickupEnabled: true, hours: [] };
  const customer = { id: 5, name: "Cliente", phone: "+34612345678", address_1: "Calle de prueba" };
  const prisma = { ...mock(),
    $executeRawUnsafe: async () => {},
    $queryRawUnsafe: async (sql) => sql.includes("FROM Partner") ? [{ id: 7, paymentPolicySettings: { cash: true } }] : [],
    store: { findFirst: async () => store, findUnique: async () => store },
    customer: { findFirst: async () => customer },
    directDiscount: { findMany: async () => [] },
    sale: { findFirst: async () => null, findUnique: async () => null, create: async ({ data }) => { const sale = { id: 42, ...data }; saved.push(sale); return sale; } },
  };
  prisma.$transaction = async (fn) => fn(prisma);
  const app = express(); app.use(express.json()); app.use(checkoutRoutes(prisma));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const post = (cart) => fetch(`http://127.0.0.1:${server.address().port}/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partnerId: 7, storeId: 3, paymentMode: "cash", customer: { id: 5 }, delivery: { method: "PICKUP" }, cart }),
  });
  const rejected = await post([{ ...line, removedIngredients: [{ ingredientId: 999 }] }]);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "ingredient_removal_unavailable");
  assert.equal(saved.length, 0);
  const accepted = await post([line, { ...line, cartLineId: "normal", removedIngredients: [] }]);
  const body = await accepted.json();
  assert.equal(accepted.status, 200, JSON.stringify(body));
  assert.equal(body.total, 40);
  assert.equal(saved.length, 1);
  const products = saved[0].products;
  assert.deepEqual(products[0].removedIngredients, [{ ingredientId: 10, name: "Cebolla" }]);
  assert.deepEqual(products[1].removedIngredients, []);
  assert.deepEqual(formatSale(saved[0]).products, products);
  assert.deepEqual(buildRepeatCartDraft(saved[0]).items[0].removedIngredients, products[0].removedIngredients);
});
