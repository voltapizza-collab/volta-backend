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
const SOURCE = "BATCH_4";

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
  item("pulpo", "octopus", "seafood", {
    es: "Pulpo",
    en: "Octopus",
    it: "Polpo",
    fr: "Poulpe",
    pt: "Polvo",
    ar: "أخطبوط",
    zh: "章鱼",
  }, ["octopus", "pulpo cocido", "polpo", "poulpe"]),
  item("cangrejo", "crab", "seafood", {
    es: "Cangrejo",
    en: "Crab",
    it: "Granchio",
    fr: "Crabe",
    pt: "Caranguejo",
    ar: "سلطعون",
    zh: "螃蟹",
  }, ["crab meat", "carne de cangrejo", "granchio"]),
  item("bacalao", "cod", "seafood", {
    es: "Bacalao",
    en: "Cod",
    it: "Baccalà",
    fr: "Morue",
    pt: "Bacalhau",
    ar: "سمك القد",
    zh: "鳕鱼",
  }, ["cod fish", "salt cod", "baccala", "bacalhau"]),
  item("alitas de pollo", "chicken_wings", "meats", {
    es: "Alitas de pollo",
    en: "Chicken wings",
    it: "Alette di pollo",
    fr: "Ailes de poulet",
    pt: "Asas de frango",
    ar: "أجنحة دجاج",
    zh: "鸡翅",
  }, ["chicken wings", "alitas", "wings"]),
  item("carne molida de cerdo", "ground_pork", "meats", {
    es: "Carne molida de cerdo",
    en: "Ground pork",
    it: "Maiale macinato",
    fr: "Porc haché",
    pt: "Carne de porco moída",
    ar: "لحم خنزير مفروم",
    zh: "猪肉末",
  }, ["minced pork", "ground pork", "pork mince"]),
  item("res ahumada", "smoked_beef", "meats", {
    es: "Res ahumada",
    en: "Smoked beef",
    it: "Manzo affumicato",
    fr: "Boeuf fumé",
    pt: "Carne bovina defumada",
    ar: "لحم بقري مدخن",
    zh: "烟熏牛肉",
  }, ["smoked beef", "beef brisket", "carne ahumada"]),
  item("carne mechada", "shredded_beef", "meats", {
    es: "Carne mechada",
    en: "Shredded beef",
    it: "Manzo sfilacciato",
    fr: "Boeuf effiloché",
    pt: "Carne desfiada",
    ar: "لحم بقري مفتت",
    zh: "手撕牛肉",
  }, ["pulled beef", "shredded beef", "carne desmechada"]),
  item("chorizo ahumado", "smoked_chorizo", "cured_meats", {
    es: "Chorizo ahumado",
    en: "Smoked chorizo",
    it: "Chorizo affumicato",
    fr: "Chorizo fumé",
    pt: "Chouriço defumado",
    ar: "تشوريزو مدخن",
    zh: "烟熏西班牙香肠",
  }, ["smoked chorizo", "chourico defumado", "chorizo fumado"]),
  item("chorizo espanol", "spanish_chorizo", "cured_meats", {
    es: "Chorizo español",
    en: "Spanish chorizo",
    it: "Chorizo spagnolo",
    fr: "Chorizo espagnol",
    pt: "Chouriço espanhol",
    ar: "تشوريزو إسباني",
    zh: "西班牙香肠",
  }, ["spanish chorizo", "chorizo iberico", "chouriço espanhol"]),
  item("chorizo picante", "spicy_chorizo", "cured_meats", {
    es: "Chorizo picante",
    en: "Spicy chorizo",
    it: "Chorizo piccante",
    fr: "Chorizo piquant",
    pt: "Chouriço picante",
    ar: "تشوريزو حار",
    zh: "辣西班牙香肠",
  }, ["spicy chorizo", "chorizo hot", "chouriço picante"]),
  item("guanciale", "guanciale", "cured_meats", {
    es: "Guanciale",
    en: "Guanciale",
    it: "Guanciale",
    fr: "Guanciale",
    pt: "Guanciale",
    ar: "غوانشالي",
    zh: "猪颊肉",
  }, ["pork jowl", "italian cured pork", "guanciale italiano"]),
  item("arzua", "arzua_cheese", "cheeses", {
    es: "Arzúa",
    en: "Arzúa cheese",
    it: "Formaggio Arzúa",
    fr: "Fromage Arzúa",
    pt: "Queijo Arzúa",
    ar: "جبن أرزوا",
    zh: "阿尔苏阿奶酪",
  }, ["arzua cheese", "queso arzua", "arzua ulloa"]),
  item("edam", "edam", "cheeses", {
    es: "Edam",
    en: "Edam",
    it: "Edam",
    fr: "Edam",
    pt: "Edam",
    ar: "إيدام",
    zh: "埃丹奶酪",
  }, ["edam cheese", "queso edam", "fromage edam"]),
  item("bocconcini", "bocconcini", "cheeses", {
    es: "Bocconcini",
    en: "Bocconcini",
    it: "Bocconcini",
    fr: "Bocconcini",
    pt: "Bocconcini",
    ar: "بوكونتشيني",
    zh: "小马苏里拉奶酪",
  }, ["mini mozzarella", "mozzarella balls", "bocconcini mozzarella"]),
  item("provolone ahumado", "smoked_provolone", "cheeses", {
    es: "Provolone ahumado",
    en: "Smoked provolone",
    it: "Provolone affumicato",
    fr: "Provolone fumé",
    pt: "Provolone defumado",
    ar: "بروفولون مدخن",
    zh: "烟熏普罗卧干酪",
  }, ["smoked provolone", "provolone affumicato", "queso provolone ahumado"]),
  item("queso de cabra curado", "aged_goat_cheese", "cheeses", {
    es: "Queso de cabra curado",
    en: "Aged goat cheese",
    it: "Formaggio di capra stagionato",
    fr: "Fromage de chèvre affiné",
    pt: "Queijo de cabra curado",
    ar: "جبن ماعز معتق",
    zh: "熟成山羊奶酪",
  }, ["aged goat cheese", "curado de cabra", "chèvre affiné"]),
  item("roquefort", "roquefort", "cheeses", {
    es: "Roquefort",
    en: "Roquefort",
    it: "Roquefort",
    fr: "Roquefort",
    pt: "Roquefort",
    ar: "روكفور",
    zh: "洛克福奶酪",
  }, ["roquefort cheese", "queso roquefort", "blue cheese roquefort"]),
  item("aceite de ajo", "garlic_oil", "oils_fats_vinegars", {
    es: "Aceite de ajo",
    en: "Garlic oil",
    it: "Olio all'aglio",
    fr: "Huile à l'ail",
    pt: "Óleo de alho",
    ar: "زيت الثوم",
    zh: "蒜香油",
  }, ["garlic oil", "aceite aromatizado con ajo", "olio all'aglio"]),
  item("aceite de maiz", "corn_oil", "oils_fats_vinegars", {
    es: "Aceite de maíz",
    en: "Corn oil",
    it: "Olio di mais",
    fr: "Huile de maïs",
    pt: "Óleo de milho",
    ar: "زيت الذرة",
    zh: "玉米油",
  }, ["corn oil", "maize oil", "aceite de maiz"]),
  item("vinagre de jerez", "sherry_vinegar", "oils_fats_vinegars", {
    es: "Vinagre de jerez",
    en: "Sherry vinegar",
    it: "Aceto di sherry",
    fr: "Vinaigre de xérès",
    pt: "Vinagre de xerez",
    ar: "خل شيري",
    zh: "雪莉醋",
  }, ["sherry vinegar", "vinagre de xeres", "jerez vinegar"]),
  item("miel", "honey", "sweeteners", {
    es: "Miel",
    en: "Honey",
    it: "Miele",
    fr: "Miel",
    pt: "Mel",
    ar: "عسل",
    zh: "蜂蜜",
  }, ["honey", "miel de abeja", "mel"]),
  item("manzana", "apple", "fruits", {
    es: "Manzana",
    en: "Apple",
    it: "Mela",
    fr: "Pomme",
    pt: "Maçã",
    ar: "تفاح",
    zh: "苹果",
  }, ["apple", "mela", "pomme"]),
  item("pera", "pear", "fruits", {
    es: "Pera",
    en: "Pear",
    it: "Pera",
    fr: "Poire",
    pt: "Pera",
    ar: "كمثرى",
    zh: "梨",
  }, ["pear", "poire"]),
  item("higos", "figs", "fruits", {
    es: "Higos",
    en: "Figs",
    it: "Fichi",
    fr: "Figues",
    pt: "Figos",
    ar: "تين",
    zh: "无花果",
  }, ["figs", "figues", "fichi"]),
  item("arandanos", "blueberries", "fruits", {
    es: "Arándanos",
    en: "Blueberries",
    it: "Mirtilli",
    fr: "Myrtilles",
    pt: "Mirtilos",
    ar: "توت أزرق",
    zh: "蓝莓",
  }, ["blueberries", "cranberries", "mirtilli", "myrtilles"]),
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
    `[ingredient-semantics-batch-4] Ingredients found: ${plan.length}/${BATCH_INGREDIENTS.length}`
  );

  plan.forEach(({ batch, ingredient }) => {
    console.log(
      `[ingredient-semantics-batch-4] #${ingredient.id} ${ingredient.name} -> ${batch.canonicalKey}`
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
    console.log("[ingredient-semantics-batch-4] Dry run. No database writes.");
    console.log(
      `[ingredient-semantics-batch-4] Would update ${plan.length} ingredients, ${translationCount} translations and ${aliasCount} aliases.`
    );
    console.log("[ingredient-semantics-batch-4] Run with --apply to write changes.");
    process.exit(0);
  }

  for (const item of plan) {
    await applyBatchIngredient(
      item.batch,
      item.ingredient,
      item.semanticCategoryId
    );
    console.log(
      `[ingredient-semantics-batch-4] Updated ${item.ingredient.name} (${item.batch.canonicalKey})`
    );
  }

  console.log("[ingredient-semantics-batch-4] Done.");
} catch (error) {
  console.error(
    "[ingredient-semantics-batch-4] Failed:",
    error?.message || error
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
