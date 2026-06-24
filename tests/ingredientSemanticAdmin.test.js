import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAliasInput,
  normalizeCanonicalKey,
  normalizeLocaleCode,
  normalizeSemanticsPayload,
  normalizeTranslationInput,
  resolveProtectedSemanticStatus,
} from "../services/ingredientSemanticAdmin.js";

test("normalizeLocaleCode accepts supported platform language shapes", () => {
  assert.equal(normalizeLocaleCode("ES"), "es");
  assert.equal(normalizeLocaleCode("pt_BR"), "pt-br");
  assert.equal(normalizeLocaleCode("zh-cn"), "zh-cn");
  assert.equal(normalizeLocaleCode("arabic"), null);
});

test("normalizeCanonicalKey creates stable ascii keys", () => {
  assert.equal(normalizeCanonicalKey(" Queso de Cabra "), "queso_de_cabra");
  assert.equal(normalizeCanonicalKey("Crème fraîche"), "creme_fraiche");
  assert.equal(normalizeCanonicalKey(""), null);
});

test("normalizeTranslationInput requires locale and name", () => {
  assert.deepEqual(normalizeTranslationInput({
    locale: "it",
    name: "Mozzarella",
    description: " Formaggio fresco ",
    isReviewed: true,
  }), {
    locale: "it",
    name: "Mozzarella",
    description: "Formaggio fresco",
    isReviewed: true,
  });

  assert.throws(
    () => normalizeTranslationInput({ locale: "it", name: "" }),
    /Translation locale and name are required/
  );
});

test("normalizeAliasInput preserves searchable Arabic and Chinese aliases", () => {
  assert.deepEqual(normalizeAliasInput({
    locale: "ar",
    country: "es",
    alias: "ثوم",
    displayable: true,
    isReviewed: true,
  }), {
    locale: "ar",
    country: "ES",
    alias: "ثوم",
    normalizedAlias: "ثوم",
    searchable: true,
    displayable: true,
    isReviewed: true,
    source: "MANUAL",
  });

  assert.equal(normalizeAliasInput({ alias: "蒜" }).normalizedAlias, "蒜");
});

test("normalizeSemanticsPayload validates status and category ids", () => {
  assert.deepEqual(normalizeSemanticsPayload({
    canonicalKey: "Ajo Fresco",
    semanticStatus: "reviewed",
    semanticCategoryId: "90",
    translations: [{ locale: "es", name: "Ajo", isReviewed: true }],
    aliases: [{ locale: "es", alias: "Ajito", searchable: true }],
  }), {
    canonicalKey: "ajo_fresco",
    semanticStatus: "REVIEWED",
    semanticCategoryId: 90,
    translations: [{
      locale: "es",
      name: "Ajo",
      description: null,
      isReviewed: true,
    }],
    aliases: [{
      locale: "es",
      country: null,
      alias: "Ajito",
      normalizedAlias: "ajito",
      searchable: true,
      displayable: false,
      isReviewed: false,
      source: "MANUAL",
    }],
  });

  assert.throws(
    () => normalizeSemanticsPayload({ semanticStatus: "PUBLISHED" }),
    /Invalid semantic status/
  );
  assert.throws(
    () => normalizeSemanticsPayload({ semanticCategoryId: "x" }),
    /Invalid semantic category id/
  );
});

test("resolveProtectedSemanticStatus only allows reviewed complete core semantics", () => {
  const completeCoreTranslations = [
    { locale: "es", name: "Ajo", isReviewed: true },
    { locale: "en", name: "Garlic", isReviewed: true },
    { locale: "it", name: "Aglio", isReviewed: true },
    { locale: "fr", name: "Ail", isReviewed: false },
  ];

  assert.equal(resolveProtectedSemanticStatus({
    requestedStatus: "REVIEWED",
    canonicalKey: "garlic",
    semanticCategoryId: 7,
    translations: completeCoreTranslations,
  }), "REVIEWED");

  assert.equal(resolveProtectedSemanticStatus({
    requestedStatus: "REVIEWED",
    canonicalKey: "garlic",
    semanticCategoryId: 7,
    translations: completeCoreTranslations.filter(
      (translation) => translation.locale !== "it"
    ),
  }), "NEEDS_REVIEW");

  assert.equal(resolveProtectedSemanticStatus({
    requestedStatus: "UNREVIEWED",
    canonicalKey: "",
    semanticCategoryId: 7,
    translations: completeCoreTranslations,
  }), "NEEDS_REVIEW");

  assert.equal(resolveProtectedSemanticStatus({
    requestedStatus: "REJECTED",
    canonicalKey: "",
    semanticCategoryId: null,
    translations: [],
  }), "REJECTED");
});
