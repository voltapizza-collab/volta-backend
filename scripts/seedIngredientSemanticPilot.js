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

const PILOT_INGREDIENTS = [
  {
    matchName: "Mozzarella",
    canonicalKey: "mozzarella",
    translations: {
      es: "Mozzarella fresca",
      en: "Fresh mozzarella",
      it: "Mozzarella fresca",
      fr: "Mozzarella fraiche",
      pt: "Mozzarella fresca",
      ar: "موزاريلا",
      zh: "马苏里拉",
    },
    aliases: ["mozzarella", "queso mozzarella", "fresh mozzarella", "fior di latte"],
  },
  {
    matchName: "Salsa Tomate",
    canonicalKey: "tomato_sauce",
    translations: {
      es: "Salsa de tomate",
      en: "Tomato sauce",
      it: "Salsa di pomodoro",
      fr: "Sauce tomate",
      pt: "Molho de tomate",
      ar: "صلصة الطماطم",
      zh: "番茄酱",
    },
    aliases: ["salsa tomate", "pizza sauce", "passata", "西红柿酱"],
  },
  {
    matchName: "Pepperoni",
    canonicalKey: "pepperoni",
    translations: {
      es: "Pepperoni",
      en: "Pepperoni",
      it: "Pepperoni",
      fr: "Pepperoni",
      pt: "Pepperoni",
      ar: "بيبروني",
      zh: "意式辣香肠",
    },
    aliases: ["salami picante", "spicy salami", "辣香肠"],
  },
  {
    matchName: "Jamón cocido (York)",
    canonicalKey: "cooked_ham",
    translations: {
      es: "Jamón cocido",
      en: "Cooked ham",
      it: "Prosciutto cotto",
      fr: "Jambon cuit",
      pt: "Fiambre",
      ar: "لحم خنزير مطبوخ",
      zh: "熟火腿",
    },
    aliases: ["jamon york", "jamón york", "ham", "york ham"],
  },
  {
    matchName: "Champiñones",
    canonicalKey: "button_mushrooms",
    translations: {
      es: "Champiñones",
      en: "Button mushrooms",
      it: "Champignon",
      fr: "Champignons de Paris",
      pt: "Cogumelos",
      ar: "فطر",
      zh: "蘑菇",
    },
    aliases: ["champiñón", "champinones", "mushrooms", "funghi"],
  },
  {
    matchName: "Cebolla",
    canonicalKey: "onion",
    translations: {
      es: "Cebolla",
      en: "Onion",
      it: "Cipolla",
      fr: "Oignon",
      pt: "Cebola",
      ar: "بصل",
      zh: "洋葱",
    },
    aliases: ["onions", "cipolla", "cebola"],
  },
  {
    matchName: "Aceite de oliva",
    canonicalKey: "olive_oil",
    translations: {
      es: "Aceite de oliva",
      en: "Olive oil",
      it: "Olio d'oliva",
      fr: "Huile d'olive",
      pt: "Azeite",
      ar: "زيت الزيتون",
      zh: "橄榄油",
    },
    aliases: ["extra virgin olive oil", "olio evo", "aove"],
  },
  {
    matchName: "Tomate fresco",
    canonicalKey: "fresh_tomato",
    translations: {
      es: "Tomate fresco",
      en: "Fresh tomato",
      it: "Pomodoro fresco",
      fr: "Tomate fraiche",
      pt: "Tomate fresco",
      ar: "طماطم طازجة",
      zh: "新鲜番茄",
    },
    aliases: ["tomato", "pomodoro", "tomate natural"],
  },
  {
    matchName: "Ajo en polvo",
    canonicalKey: "garlic_powder",
    translations: {
      es: "Ajo en polvo",
      en: "Garlic powder",
      it: "Aglio in polvere",
      fr: "Ail en poudre",
      pt: "Alho em pó",
      ar: "مسحوق الثوم",
      zh: "蒜粉",
    },
    aliases: ["ajo molido", "powdered garlic", "alho em po"],
  },
  {
    matchName: "Bacon",
    canonicalKey: "bacon",
    translations: {
      es: "Bacon",
      en: "Bacon",
      it: "Pancetta affumicata",
      fr: "Bacon",
      pt: "Bacon",
      ar: "لحم مقدد",
      zh: "培根",
    },
    aliases: ["tocino", "smoked bacon", "pancetta"],
  },
];

const prisma = new PrismaClient();

const findIngredient = async (matchName) => {
  const rows = await prisma.ingredient.findMany({
    where: { name: matchName },
    select: {
      id: true,
      name: true,
      category: true,
      canonicalKey: true,
      semanticStatus: true,
    },
  });

  if (rows.length !== 1) {
    throw new Error(
      `Expected exactly one ingredient named "${matchName}", found ${rows.length}`
    );
  }

  return rows[0];
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
    source: "PILOT",
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

const applyPilotIngredient = async (pilot, ingredient) => {
  await prisma.$transaction(
    async (tx) => {
      await tx.ingredient.update({
        where: { id: ingredient.id },
        data: {
          canonicalKey: pilot.canonicalKey,
          semanticStatus: "REVIEWED",
        },
      });

      for (const [locale, name] of Object.entries(pilot.translations)) {
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

      for (const [locale, name] of Object.entries(pilot.translations)) {
        await upsertAlias(tx, ingredient.id, {
          locale,
          value: name,
          displayable: false,
        });
      }

      for (const alias of pilot.aliases) {
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
  const plan = [];

  for (const pilot of PILOT_INGREDIENTS) {
    const ingredient = await findIngredient(pilot.matchName);
    plan.push({ pilot, ingredient });
  }

  console.log(
    `[ingredient-semantics-pilot] Ingredients found: ${plan.length}/${PILOT_INGREDIENTS.length}`
  );

  plan.forEach(({ pilot, ingredient }) => {
    console.log(
      `[ingredient-semantics-pilot] #${ingredient.id} ${ingredient.name} -> ${pilot.canonicalKey}`
    );
  });

  if (!APPLY) {
    const translationCount = plan.reduce(
      (count, { pilot }) => count + Object.keys(pilot.translations).length,
      0
    );
    const aliasCount = plan.reduce(
      (count, { pilot }) =>
        count + Object.keys(pilot.translations).length + pilot.aliases.length,
      0
    );

    console.log("[ingredient-semantics-pilot] Dry run. No database writes.");
    console.log(
      `[ingredient-semantics-pilot] Would update ${plan.length} ingredients, ${translationCount} translations and ${aliasCount} aliases.`
    );
    console.log("[ingredient-semantics-pilot] Run with --apply to write changes.");
    process.exit(0);
  }

  for (const item of plan) {
    await applyPilotIngredient(item.pilot, item.ingredient);
    console.log(
      `[ingredient-semantics-pilot] Updated ${item.ingredient.name} (${item.pilot.canonicalKey})`
    );
  }

  console.log("[ingredient-semantics-pilot] Done.");
} catch (error) {
  console.error(
    "[ingredient-semantics-pilot] Failed:",
    error?.message || error
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
