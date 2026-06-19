const REQUIRED_TABLES = [
  "IngredientTranslation",
  "IngredientAlias",
  "IngredientSemanticCategory",
  "IngredientSemanticCategoryTranslation",
];

const REQUIRED_INGREDIENT_COLUMNS = [
  "canonicalKey",
  "semanticStatus",
  "semanticCategoryId",
];

const REQUIRED_PARTNER_COLUMNS = ["backofficeLocale"];

let cachedResult = null;

const normalizeName = (value) => String(value || "").trim();

export async function ensureIngredientSemanticsAvailable(prisma) {
  if (cachedResult != null) return cachedResult;

  try {
    const [tables, ingredientColumns, partnerColumns] = await Promise.all([
      prisma.$queryRawUnsafe("SHOW TABLES"),
      prisma.$queryRawUnsafe("SHOW COLUMNS FROM `Ingredient`"),
      prisma.$queryRawUnsafe("SHOW COLUMNS FROM `Partner`"),
    ]);

    const tableNames = new Set(
      (tables || []).flatMap((row) => Object.values(row).map(normalizeName))
    );
    const columnNames = new Set(
      (ingredientColumns || []).map((row) => normalizeName(row.Field || row.field))
    );
    const partnerColumnNames = new Set(
      (partnerColumns || []).map((row) => normalizeName(row.Field || row.field))
    );

    cachedResult =
      REQUIRED_TABLES.every((tableName) => tableNames.has(tableName)) &&
      REQUIRED_INGREDIENT_COLUMNS.every((columnName) => columnNames.has(columnName)) &&
      REQUIRED_PARTNER_COLUMNS.every((columnName) => partnerColumnNames.has(columnName));
  } catch (error) {
    console.warn(
      "[ingredient-semantics] schema introspection failed:",
      error?.message || error
    );
    cachedResult = false;
  }

  return cachedResult;
}

export function clearIngredientSemanticsAvailabilityCache() {
  cachedResult = null;
}
