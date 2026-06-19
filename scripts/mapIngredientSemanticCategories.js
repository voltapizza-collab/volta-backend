import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSemanticCategoryKey } from "../services/ingredientSemanticCategoryMap.js";

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
const prisma = new PrismaClient();

const groupCounts = (rows, getKey) => {
  const counts = new Map();

  rows.forEach((row) => {
    const key = getKey(row) || "(empty)";
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()].sort((left, right) =>
    String(left[0]).localeCompare(String(right[0]))
  );
};

try {
  const semanticCategories = await prisma.ingredientSemanticCategory.findMany({
    select: {
      id: true,
      canonicalKey: true,
    },
  });

  const semanticCategoryByKey = new Map(
    semanticCategories.map((category) => [category.canonicalKey, category])
  );

  const ingredients = await prisma.ingredient.findMany({
    select: {
      id: true,
      name: true,
      category: true,
      semanticCategoryId: true,
      semanticCategory: {
        select: {
          canonicalKey: true,
        },
      },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const plan = ingredients.map((ingredient) => {
    const semanticKey = resolveSemanticCategoryKey(ingredient.category);
    const targetCategory = semanticKey
      ? semanticCategoryByKey.get(semanticKey)
      : null;

    return {
      ingredient,
      semanticKey,
      targetCategory,
      currentSemanticKey: ingredient.semanticCategory?.canonicalKey || null,
      needsUpdate:
        Boolean(targetCategory) &&
        Number(ingredient.semanticCategoryId) !== Number(targetCategory.id),
    };
  });

  const mapped = plan.filter((item) => item.targetCategory);
  const missingSeed = plan.filter(
    (item) => item.semanticKey && !item.targetCategory
  );
  const unmapped = plan.filter((item) => !item.semanticKey);
  const pending = plan.filter((item) => item.needsUpdate);

  console.log("[ingredient-semantics-map] Ingredients:", ingredients.length);
  console.log("[ingredient-semantics-map] Mapped by category:", mapped.length);
  console.log("[ingredient-semantics-map] Pending updates:", pending.length);
  console.log("[ingredient-semantics-map] Unmapped categories:", unmapped.length);

  const legacyCategoryCounts = groupCounts(ingredients, (row) => row.category);
  console.log("[ingredient-semantics-map] Legacy categories:");
  legacyCategoryCounts.forEach(([category, count]) => {
    const semanticKey = resolveSemanticCategoryKey(category) || "UNMAPPED";
    console.log(`  - ${category}: ${count} -> ${semanticKey}`);
  });

  if (missingSeed.length) {
    const missingKeys = [
      ...new Set(missingSeed.map((item) => item.semanticKey).filter(Boolean)),
    ];
    throw new Error(
      `Missing semantic category seed rows: ${missingKeys.join(", ")}`
    );
  }

  if (unmapped.length) {
    console.log("[ingredient-semantics-map] First unmapped ingredients:");
    unmapped.slice(0, 20).forEach((item) => {
      console.log(
        `  - #${item.ingredient.id} ${item.ingredient.name} (${item.ingredient.category || "no category"})`
      );
    });
  }

  if (!APPLY) {
    console.log("[ingredient-semantics-map] Dry run. No database writes.");
    console.log("[ingredient-semantics-map] Run with --apply to write changes.");
    process.exit(0);
  }

  for (const item of pending) {
    await prisma.ingredient.update({
      where: { id: item.ingredient.id },
      data: {
        semanticCategoryId: item.targetCategory.id,
      },
    });
  }

  console.log(
    `[ingredient-semantics-map] Updated ${pending.length} ingredients.`
  );
} catch (error) {
  console.error(
    "[ingredient-semantics-map] Failed:",
    error?.message || error
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
