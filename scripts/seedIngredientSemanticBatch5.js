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
const SOURCE = "BATCH_5";

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
  item("malvavisco", "marshmallow", "extras", {
    es: "Malvavisco",
    en: "Marshmallow",
    it: "Marshmallow",
    fr: "Guimauve",
    pt: "Marshmallow",
    ar: "مارشميلو",
    zh: "棉花糖",
  }, ["marshmallow", "nube de azucar", "guimauve"]),
  item("nachos", "nachos", "other", {
    es: "Nachos",
    en: "Nachos",
    it: "Nachos",
    fr: "Nachos",
    pt: "Nachos",
    ar: "ناتشوز",
    zh: "玉米片",
  }, ["tortilla chips", "totopos", "chips de maiz"]),
  item("pimienta blanca", "white_pepper", "herbs_spices", {
    es: "Pimienta blanca",
    en: "White pepper",
    it: "Pepe bianco",
    fr: "Poivre blanc",
    pt: "Pimenta branca",
    ar: "فلفل أبيض",
    zh: "白胡椒",
  }, ["white pepper", "poivre blanc", "pepe bianco"]),
  item("pina caramelizada", "caramelized_pineapple", "fruits", {
    es: "Piña caramelizada",
    en: "Caramelized pineapple",
    it: "Ananas caramellato",
    fr: "Ananas caramélisé",
    pt: "Abacaxi caramelizado",
    ar: "أناناس مكرمل",
    zh: "焦糖菠萝",
  }, ["caramelized pineapple", "pina caramelizada", "ananas caramélisé"]),
  item("calabaza asada", "roasted_pumpkin", "vegetables", {
    es: "Calabaza asada",
    en: "Roasted pumpkin",
    it: "Zucca arrosto",
    fr: "Courge rôtie",
    pt: "Abóbora assada",
    ar: "قرع مشوي",
    zh: "烤南瓜",
  }, ["roasted pumpkin", "roasted squash", "zucca arrosto"]),
  item("azúcar glass", "powdered_sugar", "sweeteners", {
    es: "Azúcar glass",
    en: "Powdered sugar",
    it: "Zucchero a velo",
    fr: "Sucre glace",
    pt: "Açúcar de confeiteiro",
    ar: "سكر بودرة",
    zh: "糖粉",
  }, ["icing sugar", "powdered sugar", "azucar glas", "sucre glace"]),
  item("azucar caramelizado", "caramelized_sugar", "sweeteners", {
    es: "Azúcar caramelizado",
    en: "Caramelized sugar",
    it: "Zucchero caramellato",
    fr: "Sucre caramélisé",
    pt: "Açúcar caramelizado",
    ar: "سكر مكرمل",
    zh: "焦糖糖",
  }, ["caramelized sugar", "caramel sugar", "azucar caramelizado"]),
  item("dulce de leche", "dulce_de_leche", "sweet_creams", {
    es: "Dulce de leche",
    en: "Dulce de leche",
    it: "Dulce de leche",
    fr: "Confiture de lait",
    pt: "Doce de leite",
    ar: "دولسي دي ليتشي",
    zh: "牛奶焦糖酱",
  }, ["milk caramel", "doce de leite", "confiture de lait"]),
  item("leche condensada", "condensed_milk", "sweet_creams", {
    es: "Leche condensada",
    en: "Condensed milk",
    it: "Latte condensato",
    fr: "Lait concentré",
    pt: "Leite condensado",
    ar: "حليب مكثف",
    zh: "炼乳",
  }, ["sweetened condensed milk", "lait concentré", "leite condensado"]),
  item("crema pastelera", "pastry_cream", "sweet_creams", {
    es: "Crema pastelera",
    en: "Pastry cream",
    it: "Crema pasticcera",
    fr: "Crème pâtissière",
    pt: "Creme de pasteleiro",
    ar: "كريمة باتيسيير",
    zh: "卡仕达酱",
  }, ["custard cream", "crema pasticcera", "crème pâtissière"]),
  item("extracto de pimienta blanca", "white_pepper_extract", "herbs_spices", {
    es: "Extracto de pimienta blanca",
    en: "White pepper extract",
    it: "Estratto di pepe bianco",
    fr: "Extrait de poivre blanc",
    pt: "Extrato de pimenta branca",
    ar: "مستخلص الفلفل الأبيض",
    zh: "白胡椒提取物",
  }, ["white pepper extract", "extracto pimienta blanca"]),
  item("extracto de pimenton", "pimenton_extract", "herbs_spices", {
    es: "Extracto de pimentón",
    en: "Pimenton extract",
    it: "Estratto di pimenton",
    fr: "Extrait de pimenton",
    pt: "Extrato de pimenton",
    ar: "مستخلص الفلفل الأحمر الإسباني",
    zh: "西班牙红椒提取物",
  }, ["pimenton extract", "paprika extract", "extracto de pimenton"]),
  item("extracto de oregano", "oregano_extract", "herbs_spices", {
    es: "Extracto de orégano",
    en: "Oregano extract",
    it: "Estratto di origano",
    fr: "Extrait d'origan",
    pt: "Extrato de orégano",
    ar: "مستخلص الأوريغانو",
    zh: "牛至提取物",
  }, ["oregano extract", "origan extract", "extracto de oregano"]),
  item("cheddar fundido", "melted_cheddar", "cheeses", {
    es: "Cheddar fundido",
    en: "Melted cheddar",
    it: "Cheddar fuso",
    fr: "Cheddar fondu",
    pt: "Cheddar derretido",
    ar: "شيدر مذاب",
    zh: "融化切达奶酪",
  }, ["melted cheddar", "cheddar sauce", "queso cheddar fundido"]),
  item("crema de coco", "coconut_cream", "sweet_creams", {
    es: "Crema de coco",
    en: "Coconut cream",
    it: "Crema di cocco",
    fr: "Crème de coco",
    pt: "Creme de coco",
    ar: "كريمة جوز الهند",
    zh: "椰子奶油",
  }, ["coconut cream", "crema coco", "crème de coco"]),
  item("pistacho", "pistachio_cream", "sweet_creams", {
    es: "Pistacho",
    en: "Pistachio cream",
    it: "Crema al pistacchio",
    fr: "Crème de pistache",
    pt: "Creme de pistache",
    ar: "كريمة الفستق",
    zh: "开心果酱",
  }, ["pistachio", "pistachio cream", "crema de pistacho"]),
  item("lotus biscoff", "biscoff_spread", "sweet_creams", {
    es: "Lotus Biscoff",
    en: "Biscoff spread",
    it: "Crema Biscoff",
    fr: "Pâte à tartiner Biscoff",
    pt: "Creme Biscoff",
    ar: "كريمة بيسكوف",
    zh: "Biscoff 饼干酱",
  }, ["lotus", "biscoff", "cookie butter", "crema lotus"]),
  item("chocolate con leche", "milk_chocolate", "sweet_creams", {
    es: "Chocolate con leche",
    en: "Milk chocolate",
    it: "Cioccolato al latte",
    fr: "Chocolat au lait",
    pt: "Chocolate ao leite",
    ar: "شوكولاتة بالحليب",
    zh: "牛奶巧克力",
  }, ["milk chocolate", "chocolate ao leite", "chocolat au lait"]),
  item("avellana tradicional", "hazelnut_cream", "sweet_creams", {
    es: "Avellana tradicional",
    en: "Hazelnut cream",
    it: "Crema alla nocciola",
    fr: "Crème de noisette",
    pt: "Creme de avelã",
    ar: "كريمة البندق",
    zh: "榛子酱",
  }, ["hazelnut cream", "crema de avellana", "nocciola"]),
  item("avellana blanca", "white_hazelnut_cream", "sweet_creams", {
    es: "Avellana blanca",
    en: "White hazelnut cream",
    it: "Crema bianca alla nocciola",
    fr: "Crème blanche de noisette",
    pt: "Creme branca de avelã",
    ar: "كريمة بندق بيضاء",
    zh: "白榛子酱",
  }, ["white hazelnut cream", "crema avellana blanca"]),
  item("salsa de arándanos", "blueberry_sauce", "sauces", {
    es: "Salsa de arándanos",
    en: "Blueberry sauce",
    it: "Salsa ai mirtilli",
    fr: "Sauce aux myrtilles",
    pt: "Molho de mirtilos",
    ar: "صلصة التوت الأزرق",
    zh: "蓝莓酱",
  }, ["blueberry sauce", "salsa arandanos", "sauce aux myrtilles"]),
  item("salsa esparragos", "asparagus_sauce", "sauces", {
    es: "Salsa de espárragos",
    en: "Asparagus sauce",
    it: "Salsa agli asparagi",
    fr: "Sauce aux asperges",
    pt: "Molho de aspargos",
    ar: "صلصة الهليون",
    zh: "芦笋酱",
  }, ["asparagus sauce", "salsa esparragos", "sauce aux asperges"]),
  item("salsa miel-mostaza", "honey_mustard_sauce", "sauces", {
    es: "Salsa miel-mostaza",
    en: "Honey mustard sauce",
    it: "Salsa miele e senape",
    fr: "Sauce miel-moutarde",
    pt: "Molho de mel e mostarda",
    ar: "صلصة العسل والخردل",
    zh: "蜂蜜芥末酱",
  }, ["honey mustard", "honey mustard sauce", "miel mostaza"]),
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
    `[ingredient-semantics-batch-5] Ingredients found: ${plan.length}/${BATCH_INGREDIENTS.length}`
  );

  plan.forEach(({ batch, ingredient }) => {
    console.log(
      `[ingredient-semantics-batch-5] #${ingredient.id} ${ingredient.name} -> ${batch.canonicalKey}`
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
    console.log("[ingredient-semantics-batch-5] Dry run. No database writes.");
    console.log(
      `[ingredient-semantics-batch-5] Would update ${plan.length} ingredients, ${translationCount} translations and ${aliasCount} aliases.`
    );
    console.log("[ingredient-semantics-batch-5] Run with --apply to write changes.");
    process.exit(0);
  }

  for (const item of plan) {
    await applyBatchIngredient(
      item.batch,
      item.ingredient,
      item.semanticCategoryId
    );
    console.log(
      `[ingredient-semantics-batch-5] Updated ${item.ingredient.name} (${item.batch.canonicalKey})`
    );
  }

  console.log("[ingredient-semantics-batch-5] Done.");
} catch (error) {
  console.error(
    "[ingredient-semantics-batch-5] Failed:",
    error?.message || error
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
