import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const CATEGORIES = [
  {
    canonicalKey: "cheeses",
    defaultName: "Cheeses",
    position: 10,
    translations: {
      es: "Quesos",
      en: "Cheeses",
      it: "Formaggi",
      fr: "Fromages",
      pt: "Queijos",
    },
  },
  {
    canonicalKey: "sauces",
    defaultName: "Sauces",
    position: 20,
    translations: {
      es: "Salsas",
      en: "Sauces",
      it: "Salse",
      fr: "Sauces",
      pt: "Molhos",
    },
  },
  {
    canonicalKey: "meats",
    defaultName: "Meats",
    position: 30,
    translations: {
      es: "Carnes",
      en: "Meats",
      it: "Carni",
      fr: "Viandes",
      pt: "Carnes",
    },
  },
  {
    canonicalKey: "cured_meats",
    defaultName: "Cured meats",
    position: 40,
    translations: {
      es: "Embutidos",
      en: "Cured meats",
      it: "Salumi",
      fr: "Charcuteries",
      pt: "Enchidos",
    },
  },
  {
    canonicalKey: "seafood",
    defaultName: "Fish and seafood",
    position: 50,
    translations: {
      es: "Pescados y mariscos",
      en: "Fish and seafood",
      it: "Pesce e frutti di mare",
      fr: "Poissons et fruits de mer",
      pt: "Peixes e mariscos",
    },
  },
  {
    canonicalKey: "vegetables",
    defaultName: "Vegetables",
    position: 60,
    translations: {
      es: "Verduras",
      en: "Vegetables",
      it: "Verdure",
      fr: "Legumes",
      pt: "Legumes",
    },
  },
  {
    canonicalKey: "mushrooms",
    defaultName: "Mushrooms",
    position: 70,
    translations: {
      es: "Setas",
      en: "Mushrooms",
      it: "Funghi",
      fr: "Champignons",
      pt: "Cogumelos",
    },
  },
  {
    canonicalKey: "fruits",
    defaultName: "Fruits",
    position: 80,
    translations: {
      es: "Frutas",
      en: "Fruits",
      it: "Frutta",
      fr: "Fruits",
      pt: "Frutas",
    },
  },
  {
    canonicalKey: "herbs_spices",
    defaultName: "Herbs and spices",
    position: 90,
    translations: {
      es: "Hierbas y especias",
      en: "Herbs and spices",
      it: "Erbe e spezie",
      fr: "Herbes et epices",
      pt: "Ervas e especiarias",
    },
  },
  {
    canonicalKey: "oils_fats_vinegars",
    defaultName: "Oils, fats and vinegars",
    position: 100,
    translations: {
      es: "Aceites, grasas y vinagres",
      en: "Oils, fats and vinegars",
      it: "Oli, grassi e aceti",
      fr: "Huiles, graisses et vinaigres",
      pt: "Oleos, gorduras e vinagres",
    },
  },
  {
    canonicalKey: "sweet_creams",
    defaultName: "Sweet creams",
    position: 110,
    translations: {
      es: "Cremas dulces",
      en: "Sweet creams",
      it: "Creme dolci",
      fr: "Cremes sucrees",
      pt: "Cremes doces",
    },
  },
  {
    canonicalKey: "sweeteners",
    defaultName: "Sweeteners",
    position: 120,
    translations: {
      es: "Endulzantes",
      en: "Sweeteners",
      it: "Dolcificanti",
      fr: "Edulcorants",
      pt: "Adocantes",
    },
  },
  {
    canonicalKey: "nuts_seeds",
    defaultName: "Nuts and seeds",
    position: 130,
    translations: {
      es: "Frutos secos y semillas",
      en: "Nuts and seeds",
      it: "Frutta secca e semi",
      fr: "Fruits secs et graines",
      pt: "Frutos secos e sementes",
    },
  },
  {
    canonicalKey: "vegan_protein",
    defaultName: "Vegan protein",
    position: 140,
    translations: {
      es: "Proteina vegana",
      en: "Vegan protein",
      it: "Proteine vegane",
      fr: "Proteine vegetale",
      pt: "Proteina vegana",
    },
  },
  {
    canonicalKey: "extras",
    defaultName: "Extras",
    position: 150,
    translations: {
      es: "Extras",
      en: "Extras",
      it: "Extra",
      fr: "Extras",
      pt: "Extras",
    },
  },
  {
    canonicalKey: "other",
    defaultName: "Other",
    position: 990,
    translations: {
      es: "Otros",
      en: "Other",
      it: "Altro",
      fr: "Autres",
      pt: "Outros",
    },
  },
];

const prisma = new PrismaClient();

const assertSemanticTablesAvailable = async () => {
  await prisma.ingredientSemanticCategory.findFirst({
    select: { id: true },
  });
};

const seedCategory = async (category) => {
  const row = await prisma.ingredientSemanticCategory.upsert({
    where: { canonicalKey: category.canonicalKey },
    update: {
      defaultName: category.defaultName,
      status: "ACTIVE",
      position: category.position,
    },
    create: {
      canonicalKey: category.canonicalKey,
      defaultName: category.defaultName,
      status: "ACTIVE",
      position: category.position,
    },
  });

  await Promise.all(
    Object.entries(category.translations).map(([locale, name]) =>
      prisma.ingredientSemanticCategoryTranslation.upsert({
        where: {
          categoryId_locale: {
            categoryId: row.id,
            locale,
          },
        },
        update: {
          name,
          isReviewed: true,
        },
        create: {
          categoryId: row.id,
          locale,
          name,
          isReviewed: true,
        },
      })
    )
  );

  return row;
};

try {
  await assertSemanticTablesAvailable();

  if (!APPLY) {
    const translationCount = CATEGORIES.reduce(
      (count, category) => count + Object.keys(category.translations).length,
      0
    );

    console.log("[ingredient-semantics-seed] Dry run. No database writes.");
    console.log(
      `[ingredient-semantics-seed] Would upsert ${CATEGORIES.length} semantic categories and ${translationCount} reviewed translations.`
    );
    console.log("[ingredient-semantics-seed] Run with --apply to write changes.");
    process.exit(0);
  }

  for (const category of CATEGORIES) {
    const row = await seedCategory(category);
    console.log(
      `[ingredient-semantics-seed] Upserted ${category.canonicalKey} (${row.id})`
    );
  }

  console.log("[ingredient-semantics-seed] Done.");
} catch (error) {
  console.error(
    "[ingredient-semantics-seed] Failed:",
    error?.message || error
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
