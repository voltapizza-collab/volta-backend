import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertIngredientsCanBeActivated,
  ensureStoreIngredientsActive,
  ensureStoresBelongToPartner,
} from "../services/storeMenuActivation.js";

test("ensureStoresBelongToPartner rejects stores outside the partner", async () => {
  const prisma = {
    store: {
      findMany: async () => [{ id: 1 }],
    },
  };

  await assert.rejects(
    () => ensureStoresBelongToPartner(prisma, { partnerId: 9, storeIds: [1, 2] }),
    (error) => {
      assert.equal(error.status, 404);
      assert.deepEqual(error.storeIds, [2]);
      return true;
    }
  );
});

test("assertIngredientsCanBeActivated rejects inactive or unpriced ingredients", async () => {
  const prisma = {
    ingredient: {
      findMany: async () => [{ id: 3 }],
    },
  };

  await assert.rejects(
    () => assertIngredientsCanBeActivated(prisma, [3, 4]),
    (error) => {
      assert.equal(error.status, 400);
      assert.deepEqual(error.ingredientIds, [4]);
      return true;
    }
  );
});

test("ensureStoreIngredientsActive upserts every recipe ingredient as active", async () => {
  const upserts = [];
  const prisma = {
    ingredient: {
      findMany: async ({ where }) => where.id.in.map((id) => ({ id })),
    },
    storeIngredientStock: {
      upsert: async (operation) => {
        upserts.push(operation);
        return operation.create;
      },
    },
  };

  await ensureStoreIngredientsActive(prisma, {
    storeIds: [10, 11],
    ingredientIds: [20, 21],
  });

  assert.equal(upserts.length, 4);
  assert.deepEqual(
    upserts.map((operation) => operation.where.storeId_ingredientId),
    [
      { storeId: 10, ingredientId: 20 },
      { storeId: 10, ingredientId: 21 },
      { storeId: 11, ingredientId: 20 },
      { storeId: 11, ingredientId: 21 },
    ]
  );
  assert.ok(upserts.every((operation) => operation.update.active === true));
  assert.ok(upserts.every((operation) => operation.create.active === true));
});
