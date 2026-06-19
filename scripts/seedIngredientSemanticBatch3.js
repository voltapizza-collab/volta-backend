import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeSearchText } from "../services/ingredientSemantics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const envPath = path.join(backendRoot, ".env");

if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  envLines.forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) return;

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const normalizedValue = rawValue.replace(/^"(.*)"$/, "$1");

    if (!(key in process.env)) {
      process.env[key] = normalizedValue;
    }
  });
}

const APPLY = process.argv.includes("--apply");
const TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 60000 };
const LOCALES = ["es", "en", "it", "fr", "pt", "ar", "zh"];

const item = (
  match,
  canonicalKey,
  semanticCategoryKey,
  translations,
  aliases = []
) => ({
  match,
  canonicalKey,
  semanticCategoryKey,
  translations,
  aliases,
});

const BATCH_INGREDIENTS = [
  item("burrata", "burrata", "cheeses", {
    es: "Burrata",
    en: "Burrata",
    it: "Burrata",
    fr: "Burrata",
    pt: "Burrata",
    ar: "\u0628\u0648\u0631\u0627\u062a\u0627",
    zh: "\u5e03\u62c9\u5854\u5976\u916a",
  }, ["burrata cheese", "queso burrata", "burrata fresca"]),
  item("brie", "brie", "cheeses", {
    es: "Brie",
    en: "Brie",
    it: "Brie",
    fr: "Brie",
    pt: "Brie",
    ar: "\u0628\u0631\u064a",
    zh: "\u5e03\u91cc\u5976\u916a",
  }, ["brie cheese", "queso brie", "fromage brie"]),
  item("emmental", "emmental", "cheeses", {
    es: "Emmental",
    en: "Emmental",
    it: "Emmental",
    fr: "Emmental",
    pt: "Emmental",
    ar: "\u0625\u064a\u0645\u0646\u062a\u0627\u0644",
    zh: "\u57c3\u95e8\u5854\u5c14\u5976\u916a",
  }, ["emmental cheese", "queso emmental"]),
  item("provolone", "provolone", "cheeses", {
    es: "Provolone",
    en: "Provolone",
    it: "Provolone",
    fr: "Provolone",
    pt: "Provolone",
    ar: "\u0628\u0631\u0648\u0641\u0648\u0644\u0648\u0646",
    zh: "\u666e\u7f57\u5367\u5e72\u916a",
  }, ["provolone cheese", "queso provolone"]),
  item("queso azul", "blue_cheese", "cheeses", {
    es: "Queso azul",
    en: "Blue cheese",
    it: "Formaggio erborinato",
    fr: "Fromage bleu",
    pt: "Queijo azul",
    ar: "\u062c\u0628\u0646 \u0623\u0632\u0631\u0642",
    zh: "\u84dd\u7eb9\u5976\u916a",
  }, ["blue cheese", "queso roquefort", "fromage bleu"]),
  item("queso crema", "cream_cheese", "cheeses", {
    es: "Queso crema",
    en: "Cream cheese",
    it: "Formaggio cremoso",
    fr: "Fromage frais",
    pt: "Queijo creme",
    ar: "\u062c\u0628\u0646 \u0643\u0631\u064a\u0645\u064a",
    zh: "\u5976\u6cb9\u5976\u916a",
  }, ["cream cheese", "queso philadelphia", "fromage frais"]),
  item("jam\u00f3n serrano", "serrano_ham", "cured_meats", {
    es: "Jamon serrano",
    en: "Serrano ham",
    it: "Prosciutto serrano",
    fr: "Jambon serrano",
    pt: "Presunto serrano",
    ar: "\u062c\u0627\u0645\u0648\u0646 \u0633\u064a\u0631\u0627\u0646\u0648",
    zh: "\u585e\u62c9\u8bfa\u706b\u817f",
  }, ["jamon serrano", "serrano ham", "spanish ham"]),
  item("salami", "salami", "cured_meats", {
    es: "Salami",
    en: "Salami",
    it: "Salame",
    fr: "Salami",
    pt: "Salame",
    ar: "\u0633\u0644\u0627\u0645\u064a",
    zh: "\u8428\u62c9\u7c73",
  }, ["salame", "salami sausage"]),
  item("pavo", "turkey", "cured_meats", {
    es: "Pavo",
    en: "Turkey",
    it: "Tacchino",
    fr: "Dinde",
    pt: "Peru",
    ar: "\u062f\u064a\u0643 \u0631\u0648\u0645\u064a",
    zh: "\u706b\u9e21\u8089",
  }, ["turkey", "dinde", "tacchino"]),
  item("prosciutto", "prosciutto", "cured_meats", {
    es: "Prosciutto",
    en: "Prosciutto",
    it: "Prosciutto crudo",
    fr: "Jambon cru italien",
    pt: "Presunto cru italiano",
    ar: "\u0628\u0631\u0648\u0634\u0648\u062a\u0648",
    zh: "\u610f\u5927\u5229\u751f\u706b\u817f",
  }, ["prosciutto crudo", "italian ham", "jambon cru"]),
  item("mortadela", "mortadella", "cured_meats", {
    es: "Mortadela",
    en: "Mortadella",
    it: "Mortadella",
    fr: "Mortadelle",
    pt: "Mortadela",
    ar: "\u0645\u0648\u0631\u062a\u0627\u062f\u064a\u0644\u0627",
    zh: "\u6469\u6258\u8fbe\u62c9\u9999\u80a0",
  }, ["mortadella", "mortadelle"]),
  item("bacon ahumado", "smoked_bacon", "cured_meats", {
    es: "Bacon ahumado",
    en: "Smoked bacon",
    it: "Bacon affumicato",
    fr: "Bacon fume",
    pt: "Bacon defumado",
    ar: "\u0644\u062d\u0645 \u0645\u0642\u062f\u062f \u0645\u062f\u062e\u0646",
    zh: "\u70df\u718f\u57f9\u6839",
  }, ["smoked bacon", "bacon fume", "bacon affumicato"]),
  item("at\u00fan", "tuna", "seafood", {
    es: "Atun",
    en: "Tuna",
    it: "Tonno",
    fr: "Thon",
    pt: "Atum",
    ar: "\u062a\u0648\u0646\u0629",
    zh: "\u91d1\u67aa\u9c7c",
  }, ["atun", "tuna", "tonno", "thon"]),
  item("anchoas", "anchovies", "seafood", {
    es: "Anchoas",
    en: "Anchovies",
    it: "Acciughe",
    fr: "Anchois",
    pt: "Anchovas",
    ar: "\u0623\u0646\u0634\u0648\u062c\u0629",
    zh: "\u9cc0\u9c7c",
  }, ["anchovies", "acciughe", "anchois"]),
  item("salm\u00f3n", "salmon", "seafood", {
    es: "Salmon",
    en: "Salmon",
    it: "Salmone",
    fr: "Saumon",
    pt: "Salmao",
    ar: "\u0633\u0644\u0645\u0648\u0646",
    zh: "\u4e09\u6587\u9c7c",
  }, ["salmon", "salmone", "saumon"]),
  item("camarones", "shrimp", "seafood", {
    es: "Camarones",
    en: "Shrimp",
    it: "Gamberi",
    fr: "Crevettes",
    pt: "Camaroes",
    ar: "\u0631\u0648\u0628\u064a\u0627\u0646",
    zh: "\u867e",
  }, ["shrimp", "prawns", "gamberi", "crevettes"]),
  item("alcachofa", "artichoke", "vegetables", {
    es: "Alcachofa",
    en: "Artichoke",
    it: "Carciofo",
    fr: "Artichaut",
    pt: "Alcachofra",
    ar: "\u062e\u0631\u0634\u0648\u0641",
    zh: "\u6d0b\u84df",
  }, ["artichoke", "carciofo", "artichaut"]),
  item("berenjena", "eggplant", "vegetables", {
    es: "Berenjena",
    en: "Eggplant",
    it: "Melanzana",
    fr: "Aubergine",
    pt: "Beringela",
    ar: "\u0628\u0627\u0630\u0646\u062c\u0627\u0646",
    zh: "\u8304\u5b50",
  }, ["aubergine", "eggplant", "melanzana"]),
  item("calabac\u00edn", "zucchini", "vegetables", {
    es: "Calabacin",
    en: "Zucchini",
    it: "Zucchina",
    fr: "Courgette",
    pt: "Courgette",
    ar: "\u0643\u0648\u0633\u0627",
    zh: "\u897f\u846b\u82a6",
  }, ["zucchini", "courgette", "zucchina"]),
  item("cebolla caramelizada", "caramelized_onion", "vegetables", {
    es: "Cebolla caramelizada",
    en: "Caramelized onion",
    it: "Cipolla caramellata",
    fr: "Oignon caramelise",
    pt: "Cebola caramelizada",
    ar: "\u0628\u0635\u0644 \u0645\u0643\u0631\u0645\u0644",
    zh: "\u7126\u7cd6\u6d0b\u8471",
  }, ["caramelized onions", "oignon caramelise", "cipolla caramellata"]),
  item("cebolla roja", "red_onion", "vegetables", {
    es: "Cebolla roja",
    en: "Red onion",
    it: "Cipolla rossa",
    fr: "Oignon rouge",
    pt: "Cebola roxa",
    ar: "\u0628\u0635\u0644 \u0623\u062d\u0645\u0631",
    zh: "\u7ea2\u6d0b\u8471",
  }, ["red onion", "oignon rouge", "cipolla rossa"]),
  item("tomates cherry", "cherry_tomatoes", "vegetables", {
    es: "Tomates cherry",
    en: "Cherry tomatoes",
    it: "Pomodorini",
    fr: "Tomates cerises",
    pt: "Tomates cereja",
    ar: "\u0637\u0645\u0627\u0637\u0645 \u0643\u0631\u0632\u064a\u0629",
    zh: "\u5723\u5973\u679c",
  }, ["cherry tomatoes", "pomodorini", "tomates cerises"]),
  item("pi\u00f1a", "pineapple", "fruits", {
    es: "Pina",
    en: "Pineapple",
    it: "Ananas",
    fr: "Ananas",
    pt: "Ananas",
    ar: "\u0623\u0646\u0627\u0646\u0627\u0633",
    zh: "\u83e0\u841d",
  }, ["pineapple", "ananas", "pina"]),
  item("aceite picante", "chili_oil", "oils_fats_vinegars", {
    es: "Aceite picante",
    en: "Chili oil",
    it: "Olio piccante",
    fr: "Huile piquante",
    pt: "Oleo picante",
    ar: "\u0632\u064a\u062a \u062d\u0627\u0631",
    zh: "\u8fa3\u6912\u6cb9",
  }, ["chili oil", "spicy oil", "olio piccante", "huile piquante"]),
  item("vinagre balsamico", "balsamic_vinegar", "oils_fats_vinegars", {
    es: "Vinagre balsamico",
    en: "Balsamic vinegar",
    it: "Aceto balsamico",
    fr: "Vinaigre balsamique",
    pt: "Vinagre balsamico",
    ar: "\u062e\u0644 \u0628\u0644\u0633\u0645\u064a",
    zh: "\u610f\u5927\u5229\u9999\u918b",
  }, ["balsamic vinegar", "aceto balsamico", "vinaigre balsamique"]),
];

const prisma = new PrismaClient();

const assertBatchShape = () => {
  const keys = new Set();

  BATCH_INGREDIENTS.forEach((batch) => {
    if (keys.has(batch.canonicalKey)) {
      throw new Error(`Duplicate canonical key in batch: ${batch.canonicalKey}`);
    }
    keys.add(batch.canonicalKey);

    const missingLocales = LOCALES.filter(
      (locale) => !String(batch.translations[locale] || "").trim()
    );
    if (missingLocales.length > 0) {
      throw new Error(
        `Missing locales for ${batch.canonicalKey}: ${missingLocales.join(", ")}`
      );
    }
  });
};

const loadSemanticCategories = async () => {
  const rows = await prisma.ingredientSemanticCategory.findMany({
    select: { id: true, canonicalKey: true },
  });

  return new Map(rows.map((row) => [row.canonicalKey, row.id]));
};

const findIngredient = async (match) => {
  const normalizedMatch = normalizeSearchText(match);
  const rows = await prisma.ingredient.findMany({
    select: {
      id: true,
      name: true,
      category: true,
      canonicalKey: true,
      semanticStatus: true,
      semanticCategoryId: true,
    },
  });

  const matches = rows.filter(
    (row) => normalizeSearchText(row.name) === normalizedMatch
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ingredient matching "${match}", found ${matches.length}`
    );
  }

  return matches[0];
};

const upsertAlias = async (tx, ingredientId, alias) => {
  const normalizedAlias = normalizeSearchText(alias.value);
  const existing = await tx.ingredientAlias.findFirst({
    where: {
      ingredientId,
      locale: alias.locale || null,
      normalizedAlias,
    },
    select: { id: true },
  });

  const data = {
    locale: alias.locale || null,
    country: null,
    alias: alias.value,
    normalizedAlias,
    searchable: true,
    displayable: alias.displayable === true,
    isReviewed: true,
    source: "BATCH_3",
  };

  if (existing) {
    await tx.ingredientAlias.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await tx.ingredientAlias.create({
    data: {
      ingredientId,
      ...data,
    },
  });
};

const applyBatchIngredient = async (batch, ingredient, semanticCategoryId) => {
  await prisma.$transaction(
    async (tx) => {
      await tx.ingredient.update({
        where: { id: ingredient.id },
        data: {
          canonicalKey: batch.canonicalKey,
          semanticStatus: "REVIEWED",
          semanticCategoryId,
        },
      });

      for (const [locale, name] of Object.entries(batch.translations)) {
        await tx.ingredientTranslation.upsert({
          where: {
            ingredientId_locale: {
              ingredientId: ingredient.id,
              locale,
            },
          },
          update: {
            name,
            description: null,
            isReviewed: true,
          },
          create: {
            ingredientId: ingredient.id,
            locale,
            name,
            description: null,
            isReviewed: true,
          },
        });
      }

      for (const [locale, name] of Object.entries(batch.translations)) {
        await upsertAlias(tx, ingredient.id, {
          locale,
          value: name,
          displayable: false,
        });
      }

      for (const alias of batch.aliases) {
        await upsertAlias(tx, ingredient.id, {
          locale: null,
          value: alias,
          displayable: false,
        });
      }
    },
    TRANSACTION_OPTIONS
  );
};

try {
  assertBatchShape();
  const semanticCategories = await loadSemanticCategories();
  const plan = [];

  for (const batch of BATCH_INGREDIENTS) {
    const semanticCategoryId = semanticCategories.get(batch.semanticCategoryKey);
    if (!semanticCategoryId) {
      throw new Error(
        `Missing semantic category "${batch.semanticCategoryKey}" for ${batch.canonicalKey}`
      );
    }

    const ingredient = await findIngredient(batch.match);
    plan.push({ batch, ingredient, semanticCategoryId });
  }

  console.log(
    `[ingredient-semantics-batch-3] Ingredients found: ${plan.length}/${BATCH_INGREDIENTS.length}`
  );

  plan.forEach(({ batch, ingredient }) => {
    console.log(
      `[ingredient-semantics-batch-3] #${ingredient.id} ${ingredient.name} -> ${batch.canonicalKey}`
    );
  });

  const translationCount = plan.reduce(
    (count, { batch }) => count + Object.keys(batch.translations).length,
    0
  );
  const aliasCount = plan.reduce(
    (count, { batch }) =>
      count + Object.keys(batch.translations).length + batch.aliases.length,
    0
  );

  if (!APPLY) {
    console.log("[ingredient-semantics-batch-3] Dry run. No database writes.");
    console.log(
      `[ingredient-semantics-batch-3] Would update ${plan.length} ingredients, ${translationCount} translations and ${aliasCount} aliases.`
    );
    console.log("[ingredient-semantics-batch-3] Run with --apply to write changes.");
    process.exit(0);
  }

  for (const item of plan) {
    await applyBatchIngredient(
      item.batch,
      item.ingredient,
      item.semanticCategoryId
    );
    console.log(
      `[ingredient-semantics-batch-3] Updated ${item.ingredient.name} (${item.batch.canonicalKey})`
    );
  }

  console.log("[ingredient-semantics-batch-3] Done.");
} catch (error) {
  console.error(
    "[ingredient-semantics-batch-3] Failed:",
    error?.message || error
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
