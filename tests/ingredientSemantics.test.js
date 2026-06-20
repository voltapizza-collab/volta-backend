import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeSearchText,
  resolveIngredientDisplay,
} from "../services/ingredientSemantics.js";

test("resolveIngredientDisplay falls back to the current ingredient name", () => {
  const resolved = resolveIngredientDisplay({
    id: 12,
    name: "Ajo",
    category: "HIERBAS_ESPECIAS",
  });

  assert.equal(resolved.displayName, "Ajo");
  assert.equal(resolved.displayCategory, "Hierbas Especias");
  assert.equal(resolved.fallbackUsed, true);
  assert.equal(resolved.semanticStatus, "UNREVIEWED");
  assert.match(resolved.searchText, /\bajo\b/);
});

test("resolveIngredientDisplay uses reviewed translation by locale", () => {
  const resolved = resolveIngredientDisplay(
    {
      id: 12,
      name: "Ajo",
      category: "HIERBAS_ESPECIAS",
      semanticStatus: "REVIEWED",
      translations: [
        { locale: "es", name: "Ajo", isReviewed: true },
        { locale: "it", name: "Aglio", description: "Aglio fresco", isReviewed: true },
      ],
    },
    { locale: "it" }
  );

  assert.equal(resolved.displayName, "Aglio");
  assert.equal(resolved.displayDescription, "Aglio fresco");
  assert.equal(resolved.fallbackUsed, false);
  assert.equal(resolved.requestedLocale, "it");
  assert.equal(resolved.resolvedLocale, "it");
  assert.equal(resolved.semanticStatus, "REVIEWED");
  assert.deepEqual(resolved.translations, [
    { locale: "es", name: "Ajo" },
    { locale: "it", name: "Aglio" },
  ]);
  assert.match(resolved.searchText, /\baglio\b/);
  assert.match(resolved.searchText, /\bajo\b/);
});

test("resolveIngredientDisplay falls back through English and Spanish translations", () => {
  const resolved = resolveIngredientDisplay(
    {
      id: 20,
      name: "Mozzarella",
      category: "QUESOS",
      translations: [
        { locale: "es", name: "Mozzarella", isReviewed: true },
        { locale: "en", name: "Mozzarella cheese", isReviewed: true },
        { locale: "pt", name: "Mussarela", isReviewed: false },
      ],
    },
    { locale: "pt" }
  );

  assert.equal(resolved.displayName, "Mozzarella cheese");
  assert.equal(resolved.fallbackUsed, true);
  assert.equal(resolved.requestedLocale, "pt");
  assert.equal(resolved.resolvedLocale, "en");
  assert.doesNotMatch(resolved.searchText, /\bmussarela\b/);
});

test("resolveIngredientDisplay resolves base locale before global fallback", () => {
  const resolved = resolveIngredientDisplay(
    {
      id: 21,
      name: "Champiñones",
      category: "SETAS",
      translations: [
        { locale: "es", name: "Champiñones", isReviewed: true },
        { locale: "fr", name: "Champignons", isReviewed: true },
      ],
    },
    { locale: "fr-FR" }
  );

  assert.equal(resolved.displayName, "Champignons");
  assert.equal(resolved.requestedLocale, "fr-fr");
  assert.equal(resolved.resolvedLocale, "fr");
  assert.equal(resolved.fallbackUsed, false);
});

test("resolveIngredientDisplay uses reviewed French translations", () => {
  const resolved = resolveIngredientDisplay(
    {
      id: 5,
      name: "Champiñones",
      category: "SETAS",
      semanticCategory: {
        defaultName: "Mushrooms",
        translations: [
          { locale: "es", name: "Setas", isReviewed: true },
          { locale: "fr", name: "Champignons", isReviewed: true },
        ],
      },
      translations: [
        { locale: "es", name: "Champiñones", isReviewed: true },
        { locale: "fr", name: "Champignons de Paris", isReviewed: true },
      ],
    },
    { locale: "fr" }
  );

  assert.equal(resolved.displayName, "Champignons de Paris");
  assert.equal(resolved.displayCategory, "Champignons");
  assert.equal(resolved.resolvedLocale, "fr");
  assert.equal(resolved.categoryResolvedLocale, "fr");
  assert.equal(resolved.categoryFallbackUsed, false);
  assert.deepEqual(resolved.translations, [
    { locale: "es", name: "Champiñones" },
    { locale: "fr", name: "Champignons de Paris" },
  ]);
});

test("resolveIngredientDisplay separates searchable and displayable aliases", () => {
  const resolved = resolveIngredientDisplay(
    {
      id: 12,
      name: "Ajo",
      category: "HIERBAS_ESPECIAS",
      aliases: [
        {
          locale: "en",
          alias: "Garlic",
          searchable: true,
          displayable: true,
          isReviewed: true,
        },
        {
          locale: "es",
          alias: "ajo molido barato",
          searchable: true,
          displayable: false,
          isReviewed: false,
        },
        {
          locale: "it",
          alias: "Aglio",
          searchable: true,
          displayable: true,
          isReviewed: true,
        },
      ],
    },
    { locale: "es" }
  );

  assert.deepEqual(resolved.aliases, ["Garlic"]);
  assert.match(resolved.searchText, /\bgarlic\b/);
  assert.match(resolved.searchText, /ajo molido barato/);
  assert.match(resolved.searchText, /\baglio\b/);
});

test("resolveIngredientDisplay uses reviewed semantic category translation", () => {
  const resolved = resolveIngredientDisplay(
    {
      id: 30,
      name: "Scamorza",
      category: "QUESOS",
      semanticCategory: {
        defaultName: "Cheeses",
        translations: [
          { locale: "es", name: "Quesos", isReviewed: true },
          { locale: "it", name: "Formaggi", isReviewed: true },
        ],
      },
    },
    { locale: "it" }
  );

  assert.equal(resolved.displayCategory, "Formaggi");
  assert.equal(resolved.categoryFallbackUsed, false);
  assert.match(resolved.searchText, /\bformaggi\b/);
});

test("normalizeSearchText keeps Arabic and Chinese characters", () => {
  const normalized = normalizeSearchText("ثوم 大蒜 Aglio fresco");

  assert.match(normalized, /ثوم/);
  assert.match(normalized, /大蒜/);
  assert.match(normalized, /aglio fresco/);
});
