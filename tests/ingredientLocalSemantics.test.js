import test from "node:test";
import assert from "node:assert/strict";
import {
  suggestLocalSemanticMapping,
  suggestLocalSemanticMappings,
} from "../services/ingredientLocalSemantics.js";

const candidate = ({
  id,
  name,
  canonicalKey,
  semanticCategoryKey,
  translations = [],
  aliases = [],
}) => ({
  id,
  name,
  displayName: name,
  canonicalKey,
  semanticCategoryKey,
  displayCategory: semanticCategoryKey,
  searchText: [
    name,
    canonicalKey,
    ...translations.map((translation) => translation.name),
    ...aliases.map((alias) => alias.alias),
  ].join(" "),
  semanticTranslations: translations,
  semanticAliases: aliases,
});

test("suggestLocalSemanticMapping finds exact local names through translations", () => {
  const suggestion = suggestLocalSemanticMapping(
    { name: "Mozzarella demo", category: "CHEESE" },
    [
      candidate({
        id: 3,
        name: "Mozzarella",
        canonicalKey: "mozzarella",
        semanticCategoryKey: "cheeses",
        translations: [{ locale: "es", name: "Mozzarella", isReviewed: true }],
      }),
      candidate({
        id: 41,
        name: "Chili oil",
        canonicalKey: "chili_oil",
        semanticCategoryKey: "oils_fats_vinegars",
      }),
    ]
  );

  assert.equal(suggestion.ingredient.canonicalKey, "mozzarella");
  assert.equal(suggestion.confidence, "HIGH");
  assert.ok(suggestion.score >= 90);
});

test("suggestLocalSemanticMapping uses aliases for local ingredient mapping", () => {
  const suggestion = suggestLocalSemanticMapping(
    { name: "Champinones demo", category: "VEGETABLE" },
    [
      candidate({
        id: 4,
        name: "Button mushrooms",
        canonicalKey: "button_mushrooms",
        semanticCategoryKey: "mushrooms",
        aliases: [{ alias: "champinones" }],
      }),
    ]
  );

  assert.equal(suggestion.ingredient.canonicalKey, "button_mushrooms");
  assert.equal(suggestion.confidence, "HIGH");
});

test("suggestLocalSemanticMapping gives sauce tomato domain hints", () => {
  const suggestion = suggestLocalSemanticMapping(
    { name: "Tomate San Marzano demo", category: "SAUCE" },
    [
      candidate({
        id: 2,
        name: "Tomato sauce",
        canonicalKey: "tomato_sauce",
        semanticCategoryKey: "sauces",
        translations: [{ locale: "es", name: "Salsa de tomate", isReviewed: true }],
      }),
      candidate({
        id: 7,
        name: "Fresh tomato",
        canonicalKey: "fresh_tomato",
        semanticCategoryKey: "vegetables",
        translations: [{ locale: "es", name: "Tomate fresco", isReviewed: true }],
      }),
    ]
  );

  assert.equal(suggestion.ingredient.canonicalKey, "tomato_sauce");
  assert.ok(suggestion.score >= 45);
});

test("suggestLocalSemanticMappings returns ranked alternatives for audit", () => {
  const suggestions = suggestLocalSemanticMappings(
    { name: "Tomate demo", category: "SAUCE" },
    [
      candidate({
        id: 2,
        name: "Tomato sauce",
        canonicalKey: "tomato_sauce",
        semanticCategoryKey: "sauces",
        translations: [{ locale: "es", name: "Salsa de tomate", isReviewed: true }],
      }),
      candidate({
        id: 7,
        name: "Fresh tomato",
        canonicalKey: "fresh_tomato",
        semanticCategoryKey: "vegetables",
        translations: [{ locale: "es", name: "Tomate fresco", isReviewed: true }],
      }),
      candidate({
        id: 8,
        name: "Cherry tomato",
        canonicalKey: "cherry_tomato",
        semanticCategoryKey: "vegetables",
      }),
    ],
    2
  );

  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].ingredient.canonicalKey, "tomato_sauce");
  assert.ok(suggestions[0].score >= suggestions[1].score);
});
