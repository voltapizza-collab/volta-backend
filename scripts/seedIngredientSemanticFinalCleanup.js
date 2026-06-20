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
const SOURCE = "FINAL_CLEANUP";
const LOCALES = ["es", "en", "it", "fr", "pt", "ar", "zh"];

const REVIEWED_CANONICAL = {
  id: 34,
  canonicalKey: "cheddar",
  semanticCategoryKey: "cheeses",
  translations: {
    es: "Cheddar",
    en: "Cheddar",
    it: "Cheddar",
    fr: "Cheddar",
    pt: "Cheddar",
    ar: "جبن شيدر",
    zh: "切达奶酪",
  },
  aliases: [
    "cheddar cheese",
    "queso cheddar",
    "formaggio cheddar",
    "fromage cheddar",
    "queijo cheddar",
  ],
};

const REJECTED_DUPLICATES = [
  {
    id: 35,
    targetCanonicalKey: "cheddar",
    reason: "Duplicate Cheddar row; canonical identity kept on ingredient #34.",
  },
  {
    id: 47,
    targetCanonicalKey: "sweet_corn",
    reason: "Duplicate/local spelling of sweet corn.",
    targetAliases: [
      { locale: "es", value: "Maíz" },
      { locale: null, value: "maiz" },
    ],
  },
  {
    id: 54,
    targetCanonicalKey: "mozzarella",
    reason: "Operational mozzarella filling format, not a global ingredient identity.",
    targetAliases: [
      { locale: "es", value: "Relleno de mozzarella" },
      { locale: "es", value: "Relleno de Mozzarela" },
      { locale: null, value: "mozzarella filling" },
    ],
  },
  {
    id: 71,
    targetCanonicalKey: "chili_oil",
    reason: "Duplicate naming for chili oil.",
    targetAliases: [
      { locale: "es", value: "Aceite de chile" },
      { locale: null, value: "chile oil" },
    ],
  },
  {
    id: 75,
    targetCanonicalKey: "pimenton_extract",
    reason: "Paprika extract is covered by pimenton extract.",
    targetAliases: [
      { locale: "es", value: "Extracto de paprika" },
      { locale: null, value: "paprika extract" },
    ],
  },
  {
    id: 126,
    targetCanonicalKey: "mozzarella",
    reason: "Packaged mozzarella filling format, not a global ingredient identity.",
    targetAliases: [
      { locale: "es", value: "1kg Relleno de mozzarella" },
      { locale: "es", value: "1kg Relleno de Mozzarela" },
      { locale: null, value: "1kg mozzarella filling" },
    ],
  },
];

const prisma = new PrismaClient();

const assertCleanupShape = () => {
  const missingLocales = LOCALES.filter(
    (locale) => !String(REVIEWED_CANONICAL.translations[locale] || "").trim()
  );

  if (missingLocales.length > 0) {
    throw new Error(
      `Missing locales for ${REVIEWED_CANONICAL.canonicalKey}: ${missingLocales.join(", ")}`
    );
  }

  const ids = new Set([REVIEWED_CANONICAL.id]);
  for (const duplicate of REJECTED_DUPLICATES) {
    if (ids.has(duplicate.id)) {
      throw new Error(`Duplicate cleanup id: ${duplicate.id}`);
    }
    ids.add(duplicate.id);
  }
};

const loadSemanticCategories = async () => {
  const rows = await prisma.ingredientSemanticCategory.findMany({
    select: { id: true, canonicalKey: true },
  });

  return new Map(rows.map((row) => [row.canonicalKey, row.id]));
};

const loadIngredientsById = async (ids) => {
  const rows = await prisma.ingredient.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      category: true,
      canonicalKey: true,
      semanticStatus: true,
      semanticCategoryId: true,
    },
  });

  return new Map(rows.map((row) => [row.id, row]));
};

const loadIngredientsByCanonicalKey = async (keys) => {
  const existingKeys = keys.filter(
    (key) => key !== REVIEWED_CANONICAL.canonicalKey
  );

  if (existingKeys.length === 0) {
    return new Map();
  }

  const rows = await prisma.ingredient.findMany({
    where: { canonicalKey: { in: existingKeys } },
    select: { id: true, name: true, canonicalKey: true },
  });

  return new Map(rows.map((row) => [row.canonicalKey, row]));
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
    displayable: false,
    isReviewed: true,
    source: SOURCE,
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

const applyReviewedCanonical = async (ingredient, semanticCategoryId) => {
  await prisma.$transaction(
    async (tx) => {
      await tx.ingredient.update({
        where: { id: ingredient.id },
        data: {
          canonicalKey: REVIEWED_CANONICAL.canonicalKey,
          semanticStatus: "REVIEWED",
          semanticCategoryId,
        },
      });

      for (const [locale, name] of Object.entries(REVIEWED_CANONICAL.translations)) {
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

      for (const [locale, name] of Object.entries(REVIEWED_CANONICAL.translations)) {
        await upsertAlias(tx, ingredient.id, { locale, value: name });
      }

      for (const alias of REVIEWED_CANONICAL.aliases) {
        await upsertAlias(tx, ingredient.id, { locale: null, value: alias });
      }
    },
    TRANSACTION_OPTIONS
  );
};

const applyRejectedDuplicate = async (duplicate, target) => {
  await prisma.$transaction(
    async (tx) => {
      await tx.ingredient.update({
        where: { id: duplicate.id },
        data: {
          canonicalKey: null,
          semanticStatus: "REJECTED",
        },
      });

      await tx.ingredientTranslation.deleteMany({
        where: { ingredientId: duplicate.id },
      });
      await tx.ingredientAlias.deleteMany({
        where: { ingredientId: duplicate.id },
      });

      for (const alias of duplicate.targetAliases || []) {
        await upsertAlias(tx, target.id, alias);
      }
    },
    TRANSACTION_OPTIONS
  );
};

try {
  assertCleanupShape();

  const cleanupIds = [
    REVIEWED_CANONICAL.id,
    ...REJECTED_DUPLICATES.map((duplicate) => duplicate.id),
  ];
  const targetCanonicalKeys = [
    ...new Set(REJECTED_DUPLICATES.map((duplicate) => duplicate.targetCanonicalKey)),
  ];

  const [semanticCategories, ingredientsById, targetsByKey] = await Promise.all([
    loadSemanticCategories(),
    loadIngredientsById(cleanupIds),
    loadIngredientsByCanonicalKey(targetCanonicalKeys),
  ]);

  const semanticCategoryId = semanticCategories.get(
    REVIEWED_CANONICAL.semanticCategoryKey
  );
  if (!semanticCategoryId) {
    throw new Error(
      `Missing semantic category "${REVIEWED_CANONICAL.semanticCategoryKey}"`
    );
  }

  const reviewedIngredient = ingredientsById.get(REVIEWED_CANONICAL.id);
  if (!reviewedIngredient) {
    throw new Error(`Missing ingredient #${REVIEWED_CANONICAL.id}`);
  }

  const getTarget = (canonicalKey) => {
    if (canonicalKey === REVIEWED_CANONICAL.canonicalKey) {
      return {
        id: reviewedIngredient.id,
        name: reviewedIngredient.name,
        canonicalKey: REVIEWED_CANONICAL.canonicalKey,
      };
    }

    return targetsByKey.get(canonicalKey);
  };

  for (const duplicate of REJECTED_DUPLICATES) {
    if (!ingredientsById.has(duplicate.id)) {
      throw new Error(`Missing ingredient #${duplicate.id}`);
    }

    if (!getTarget(duplicate.targetCanonicalKey)) {
      throw new Error(
        `Missing target canonical ingredient "${duplicate.targetCanonicalKey}" for #${duplicate.id}`
      );
    }
  }

  console.log("[ingredient-semantics-final-cleanup] Plan:");
  console.log(
    `[ingredient-semantics-final-cleanup] REVIEWED #${reviewedIngredient.id} ${reviewedIngredient.name} -> ${REVIEWED_CANONICAL.canonicalKey}`
  );

  for (const duplicate of REJECTED_DUPLICATES) {
    const ingredient = ingredientsById.get(duplicate.id);
    const target = getTarget(duplicate.targetCanonicalKey);
    console.log(
      `[ingredient-semantics-final-cleanup] REJECTED #${ingredient.id} ${ingredient.name} -> alias target ${target.canonicalKey} (#${target.id}). ${duplicate.reason}`
    );
  }

  const translationCount = Object.keys(REVIEWED_CANONICAL.translations).length;
  const canonicalAliasCount =
    translationCount + REVIEWED_CANONICAL.aliases.length;
  const targetAliasCount = REJECTED_DUPLICATES.reduce(
    (count, duplicate) => count + (duplicate.targetAliases || []).length,
    0
  );

  if (!APPLY) {
    console.log("[ingredient-semantics-final-cleanup] Dry run. No database writes.");
    console.log(
      `[ingredient-semantics-final-cleanup] Would review 1 ingredient, reject ${REJECTED_DUPLICATES.length}, upsert ${translationCount} translations and ${canonicalAliasCount + targetAliasCount} aliases.`
    );
    console.log(
      "[ingredient-semantics-final-cleanup] Run with --apply to write changes."
    );
    process.exit(0);
  }

  await applyReviewedCanonical(reviewedIngredient, semanticCategoryId);
  console.log(
    `[ingredient-semantics-final-cleanup] Updated #${reviewedIngredient.id} ${reviewedIngredient.name} (${REVIEWED_CANONICAL.canonicalKey})`
  );

  for (const duplicate of REJECTED_DUPLICATES) {
    const target = getTarget(duplicate.targetCanonicalKey);
    await applyRejectedDuplicate(duplicate, target);
    const ingredient = ingredientsById.get(duplicate.id);
    console.log(
      `[ingredient-semantics-final-cleanup] Rejected #${ingredient.id} ${ingredient.name}; aliases attached to ${target.canonicalKey}`
    );
  }

  console.log("[ingredient-semantics-final-cleanup] Done.");
} catch (error) {
  console.error(
    "[ingredient-semantics-final-cleanup] Failed:",
    error?.message || error
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
