import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureIngredientMediaColumns } from "../services/ingredientMediaColumns.js";

test("ensureIngredientMediaColumns creates ingredient image review columns", async () => {
  const executed = [];
  const prisma = {
    $queryRawUnsafe: async () => [{ Field: "description" }],
    $executeRawUnsafe: async (sql) => {
      executed.push(sql);
    },
  };

  await ensureIngredientMediaColumns(prisma);

  assert.ok(
    executed.some((sql) => sql.includes("ADD COLUMN `imageStatus`")),
    "imageStatus column should be created"
  );
  assert.ok(
    executed.some((sql) => sql.includes("ADD COLUMN `imagePolicyVersion`")),
    "imagePolicyVersion column should be created"
  );
  assert.ok(
    executed.some((sql) => sql.includes("Ingredient_imageStatus_idx")),
    "imageStatus index should be created"
  );
});

