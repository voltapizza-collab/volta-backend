import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLegacyIngredientCategory,
  resolveSemanticCategoryKey,
} from "../services/ingredientSemanticCategoryMap.js";

test("normalizeLegacyIngredientCategory produces stable legacy category keys", () => {
  assert.equal(
    normalizeLegacyIngredientCategory("Pescados y mariscos"),
    "PESCADOS_Y_MARISCOS"
  );
  assert.equal(
    normalizeLegacyIngredientCategory(" proteína vegana "),
    "PROTEINA_VEGANA"
  );
});

test("resolveSemanticCategoryKey maps legacy ingredient category aliases", () => {
  assert.equal(resolveSemanticCategoryKey("QUESOS"), "cheeses");
  assert.equal(resolveSemanticCategoryKey("FIAMBRES"), "cured_meats");
  assert.equal(resolveSemanticCategoryKey("PESCADOS"), "seafood");
  assert.equal(resolveSemanticCategoryKey("MARISCOS"), "seafood");
  assert.equal(resolveSemanticCategoryKey("ESPECIAS"), "herbs_spices");
  assert.equal(resolveSemanticCategoryKey("ACEITES"), "oils_fats_vinegars");
});

test("resolveSemanticCategoryKey returns null for unknown categories", () => {
  assert.equal(resolveSemanticCategoryKey("NO_EXISTE"), null);
  assert.equal(resolveSemanticCategoryKey(""), null);
  assert.equal(resolveSemanticCategoryKey(null), null);
});
