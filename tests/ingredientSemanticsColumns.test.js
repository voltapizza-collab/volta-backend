import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearIngredientSemanticsAvailabilityCache,
  ensureIngredientSemanticsAvailable,
} from "../services/ingredientSemanticsColumns.js";

test("ensureIngredientSemanticsAvailable returns true when tables and columns exist", async () => {
  clearIngredientSemanticsAvailabilityCache();

  const prisma = {
    $queryRawUnsafe: async (sql) => {
      if (sql.includes("SHOW TABLES")) {
        return [
          { Tables_in_test: "IngredientTranslation" },
          { Tables_in_test: "IngredientAlias" },
          { Tables_in_test: "IngredientSemanticCategory" },
          { Tables_in_test: "IngredientSemanticCategoryTranslation" },
        ];
      }

      if (sql.includes("SHOW COLUMNS FROM `Ingredient`")) {
        return [
          { Field: "canonicalKey" },
          { Field: "semanticStatus" },
          { Field: "semanticCategoryId" },
        ];
      }

      return [
        { Field: "backofficeLocale" },
      ];
    },
  };

  assert.equal(await ensureIngredientSemanticsAvailable(prisma), true);
});

test("ensureIngredientSemanticsAvailable returns false when partner locale column is missing", async () => {
  clearIngredientSemanticsAvailabilityCache();

  const prisma = {
    $queryRawUnsafe: async (sql) => {
      if (sql.includes("SHOW TABLES")) {
        return [
          { Tables_in_test: "IngredientTranslation" },
          { Tables_in_test: "IngredientAlias" },
          { Tables_in_test: "IngredientSemanticCategory" },
          { Tables_in_test: "IngredientSemanticCategoryTranslation" },
        ];
      }

      if (sql.includes("SHOW COLUMNS FROM `Ingredient`")) {
        return [
          { Field: "canonicalKey" },
          { Field: "semanticStatus" },
          { Field: "semanticCategoryId" },
        ];
      }

      return [
        { Field: "name" },
        { Field: "country" },
      ];
    },
  };

  assert.equal(await ensureIngredientSemanticsAvailable(prisma), false);
});

test("ensureIngredientSemanticsAvailable returns false when migration is missing", async () => {
  clearIngredientSemanticsAvailabilityCache();

  const prisma = {
    $queryRawUnsafe: async (sql) => {
      if (sql.includes("SHOW TABLES")) {
        return [{ Tables_in_test: "Ingredient" }];
      }

      if (sql.includes("SHOW COLUMNS FROM `Ingredient`")) {
        return [{ Field: "name" }, { Field: "category" }];
      }

      return [
        { Field: "canonicalKey" },
        { Field: "backofficeLocale" },
      ];
    },
  };

  assert.equal(await ensureIngredientSemanticsAvailable(prisma), false);
});

test("ensureIngredientSemanticsAvailable caches introspection result", async () => {
  clearIngredientSemanticsAvailabilityCache();
  let calls = 0;

  const prisma = {
    $queryRawUnsafe: async () => {
      calls += 1;
      throw new Error("offline");
    },
  };

  assert.equal(await ensureIngredientSemanticsAvailable(prisma), false);
  assert.equal(await ensureIngredientSemanticsAvailable(prisma), false);
  assert.equal(calls, 3);
});
