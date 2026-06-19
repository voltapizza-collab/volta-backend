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

const BATCH_INGREDIENTS = [
  {
    match: "pollo",
    canonicalKey: "chicken",
    semanticCategoryKey: "meats",
    translations: {
      es: "Pollo",
      en: "Chicken",
      it: "Pollo",
      fr: "Poulet",
      pt: "Frango",
      ar: "دجاج",
      zh: "鸡肉",
    },
    aliases: ["chicken", "poulet", "frango"],
  },
  {
    match: "pollo en tira",
    canonicalKey: "chicken_strips",
    semanticCategoryKey: "meats",
    translations: {
      es: "Pollo en tiras",
      en: "Chicken strips",
      it: "Strisce di pollo",
      fr: "Lamelles de poulet",
      pt: "Tiras de frango",
      ar: "شرائح دجاج",
      zh: "鸡肉条",
    },
    aliases: ["chicken strips", "tiras de pollo", "lamelles de poulet"],
  },
  {
    match: "chorizo",
    canonicalKey: "chorizo",
    semanticCategoryKey: "meats",
    translations: {
      es: "Chorizo",
      en: "Chorizo",
      it: "Chorizo",
      fr: "Chorizo",
      pt: "Chourico",
      ar: "شوريزو",
      zh: "西班牙辣香肠",
    },
    aliases: ["spanish sausage", "chourico"],
  },
  {
    match: "salchicha italiana",
    canonicalKey: "italian_sausage",
    semanticCategoryKey: "meats",
    translations: {
      es: "Salchicha italiana",
      en: "Italian sausage",
      it: "Salsiccia italiana",
      fr: "Saucisse italienne",
      pt: "Salsicha italiana",
      ar: "نقانق إيطالية",
      zh: "意大利香肠",
    },
    aliases: ["italian sausage", "salsiccia", "saucisse italienne"],
  },
  {
    match: "carne picada",
    canonicalKey: "minced_beef",
    semanticCategoryKey: "meats",
    translations: {
      es: "Carne picada",
      en: "Minced beef",
      it: "Carne macinata",
      fr: "Viande hachee",
      pt: "Carne picada",
      ar: "لحم مفروم",
      zh: "碎牛肉",
    },
    aliases: ["ground beef", "minced meat", "viande hachee"],
  },
  {
    match: "ternera",
    canonicalKey: "beef",
    semanticCategoryKey: "meats",
    translations: {
      es: "Ternera",
      en: "Beef",
      it: "Manzo",
      fr: "Boeuf",
      pt: "Carne de vaca",
      ar: "لحم بقري",
      zh: "牛肉",
    },
    aliases: ["beef", "boeuf", "manzo"],
  },
  {
    match: "champinones blancos",
    canonicalKey: "white_button_mushrooms",
    semanticCategoryKey: "mushrooms",
    translations: {
      es: "Champinones blancos",
      en: "White button mushrooms",
      it: "Champignon bianchi",
      fr: "Champignons blancs",
      pt: "Cogumelos brancos",
      ar: "فطر أبيض",
      zh: "白蘑菇",
    },
    aliases: ["white mushrooms", "white button mushrooms", "champignon blanc"],
  },
  {
    match: "trufa",
    canonicalKey: "truffle",
    semanticCategoryKey: "mushrooms",
    translations: {
      es: "Trufa",
      en: "Truffle",
      it: "Tartufo",
      fr: "Truffe",
      pt: "Trufa",
      ar: "كمأة",
      zh: "松露",
    },
    aliases: ["truffle", "tartufo", "truffe"],
  },
  {
    match: "trufa negra",
    canonicalKey: "black_truffle",
    semanticCategoryKey: "mushrooms",
    translations: {
      es: "Trufa negra",
      en: "Black truffle",
      it: "Tartufo nero",
      fr: "Truffe noire",
      pt: "Trufa negra",
      ar: "كمأة سوداء",
      zh: "黑松露",
    },
    aliases: ["black truffle", "tartufo nero", "truffe noire"],
  },
  {
    match: "parmesano",
    canonicalKey: "parmesan",
    semanticCategoryKey: "cheeses",
    translations: {
      es: "Parmesano",
      en: "Parmesan",
      it: "Parmigiano",
      fr: "Parmesan",
      pt: "Parmesao",
      ar: "بارميزان",
      zh: "帕尔马干酪",
    },
    aliases: ["parmesan", "parmigiano", "parmesao"],
  },
  {
    match: "queso de cabra",
    canonicalKey: "goat_cheese",
    semanticCategoryKey: "cheeses",
    translations: {
      es: "Queso de cabra",
      en: "Goat cheese",
      it: "Formaggio di capra",
      fr: "Fromage de chevre",
      pt: "Queijo de cabra",
      ar: "جبن ماعز",
      zh: "山羊奶酪",
    },
    aliases: ["goat cheese", "chevre", "fromage de chevre"],
  },
  {
    match: "gorgonzola",
    canonicalKey: "gorgonzola",
    semanticCategoryKey: "cheeses",
    translations: {
      es: "Gorgonzola",
      en: "Gorgonzola",
      it: "Gorgonzola",
      fr: "Gorgonzola",
      pt: "Gorgonzola",
      ar: "جبن جورجونزولا",
      zh: "戈贡佐拉奶酪",
    },
    aliases: ["blue cheese", "queso azul italiano"],
  },
  {
    match: "ricotta",
    canonicalKey: "ricotta",
    semanticCategoryKey: "cheeses",
    translations: {
      es: "Ricotta",
      en: "Ricotta",
      it: "Ricotta",
      fr: "Ricotta",
      pt: "Ricota",
      ar: "ريكوتا",
      zh: "乳清干酪",
    },
    aliases: ["ricota", "whey cheese"],
  },
  {
    match: "pimiento rojo",
    canonicalKey: "red_bell_pepper",
    semanticCategoryKey: "vegetables",
    translations: {
      es: "Pimiento rojo",
      en: "Red bell pepper",
      it: "Peperone rosso",
      fr: "Poivron rouge",
      pt: "Pimento vermelho",
      ar: "فلفل أحمر",
      zh: "红甜椒",
    },
    aliases: ["red pepper", "red capsicum", "poivron rouge"],
  },
  {
    match: "pimiento verde",
    canonicalKey: "green_bell_pepper",
    semanticCategoryKey: "vegetables",
    translations: {
      es: "Pimiento verde",
      en: "Green bell pepper",
      it: "Peperone verde",
      fr: "Poivron vert",
      pt: "Pimento verde",
      ar: "فلفل أخضر",
      zh: "青椒",
    },
    aliases: ["green pepper", "green capsicum", "poivron vert"],
  },
  {
    match: "maiz dulce",
    canonicalKey: "sweet_corn",
    semanticCategoryKey: "vegetables",
    translations: {
      es: "Maiz dulce",
      en: "Sweet corn",
      it: "Mais dolce",
      fr: "Mais doux",
      pt: "Milho doce",
      ar: "ذرة حلوة",
      zh: "甜玉米",
    },
    aliases: ["corn", "sweetcorn", "milho doce"],
  },
  {
    match: "jalapeno",
    canonicalKey: "jalapeno",
    semanticCategoryKey: "vegetables",
    translations: {
      es: "Jalapeno",
      en: "Jalapeno",
      it: "Jalapeno",
      fr: "Jalapeno",
      pt: "Jalapeno",
      ar: "هالبينو",
      zh: "墨西哥辣椒",
    },
    aliases: ["jalapeno pepper", "chile jalapeno"],
  },
  {
    match: "salsa pesto",
    canonicalKey: "pesto_sauce",
    semanticCategoryKey: "sauces",
    translations: {
      es: "Salsa pesto",
      en: "Pesto sauce",
      it: "Pesto",
      fr: "Sauce pesto",
      pt: "Molho pesto",
      ar: "صلصة بيستو",
      zh: "青酱",
    },
    aliases: ["pesto", "basil pesto", "pesto sauce"],
  },
  {
    match: "salsa bbq",
    canonicalKey: "bbq_sauce",
    semanticCategoryKey: "sauces",
    translations: {
      es: "Salsa BBQ",
      en: "BBQ sauce",
      it: "Salsa barbecue",
      fr: "Sauce barbecue",
      pt: "Molho barbecue",
      ar: "صلصة باربكيو",
      zh: "烧烤酱",
    },
    aliases: ["barbecue sauce", "bbq", "sauce barbecue"],
  },
  {
    match: "salsa picante",
    canonicalKey: "hot_sauce",
    semanticCategoryKey: "sauces",
    translations: {
      es: "Salsa picante",
      en: "Hot sauce",
      it: "Salsa piccante",
      fr: "Sauce piquante",
      pt: "Molho picante",
      ar: "صلصة حارة",
      zh: "辣酱",
    },
    aliases: ["spicy sauce", "hot sauce", "sauce piquante"],
  },
  {
    match: "salsa de ajo",
    canonicalKey: "garlic_sauce",
    semanticCategoryKey: "sauces",
    translations: {
      es: "Salsa de ajo",
      en: "Garlic sauce",
      it: "Salsa all'aglio",
      fr: "Sauce a l'ail",
      pt: "Molho de alho",
      ar: "صلصة الثوم",
      zh: "蒜蓉酱",
    },
    aliases: ["garlic sauce", "aioli", "sauce ail"],
  },
  {
    match: "aceitunas negras",
    canonicalKey: "black_olives",
    semanticCategoryKey: "vegetables",
    translations: {
      es: "Aceitunas negras",
      en: "Black olives",
      it: "Olive nere",
      fr: "Olives noires",
      pt: "Azeitonas pretas",
      ar: "زيتون أسود",
      zh: "黑橄榄",
    },
    aliases: ["black olives", "olive nere", "olives noires"],
  },
  {
    match: "aceitunas verdes",
    canonicalKey: "green_olives",
    semanticCategoryKey: "vegetables",
    translations: {
      es: "Aceitunas verdes",
      en: "Green olives",
      it: "Olive verdi",
      fr: "Olives vertes",
      pt: "Azeitonas verdes",
      ar: "زيتون أخضر",
      zh: "绿橄榄",
    },
    aliases: ["green olives", "olive verdi", "olives vertes"],
  },
];

const prisma = new PrismaClient();

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
    source: "BATCH_2",
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
    `[ingredient-semantics-batch-2] Ingredients found: ${plan.length}/${BATCH_INGREDIENTS.length}`
  );

  plan.forEach(({ batch, ingredient }) => {
    console.log(
      `[ingredient-semantics-batch-2] #${ingredient.id} ${ingredient.name} -> ${batch.canonicalKey}`
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
    console.log("[ingredient-semantics-batch-2] Dry run. No database writes.");
    console.log(
      `[ingredient-semantics-batch-2] Would update ${plan.length} ingredients, ${translationCount} translations and ${aliasCount} aliases.`
    );
    console.log("[ingredient-semantics-batch-2] Run with --apply to write changes.");
    process.exit(0);
  }

  for (const item of plan) {
    await applyBatchIngredient(
      item.batch,
      item.ingredient,
      item.semanticCategoryId
    );
    console.log(
      `[ingredient-semantics-batch-2] Updated ${item.ingredient.name} (${item.batch.canonicalKey})`
    );
  }

  console.log("[ingredient-semantics-batch-2] Done.");
} catch (error) {
  console.error(
    "[ingredient-semantics-batch-2] Failed:",
    error?.message || error
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
