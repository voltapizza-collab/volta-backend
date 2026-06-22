export async function ensureIngredientMediaColumns(prisma) {
  const columns = [
    ["description", "TEXT NULL"],
    ["image", "TEXT NULL"],
    ["imagePublicId", "VARCHAR(255) NULL"],
    ["imageStatus", "VARCHAR(191) NOT NULL DEFAULT 'MISSING'"],
    ["imageSource", "VARCHAR(191) NULL"],
    ["imagePrompt", "TEXT NULL"],
    ["imageReviewedAt", "DATETIME(3) NULL"],
    ["imageReviewedBy", "VARCHAR(191) NULL"],
    ["imageVersion", "INTEGER NOT NULL DEFAULT 0"],
    ["imagePolicyVersion", "VARCHAR(191) NULL"],
  ];

  let existingColumns = new Set();

  try {
    const rows = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM `Ingredient`");
    existingColumns = new Set(
      (rows || []).map((row) => String(row.Field || row.field || "").trim())
    );
  } catch (error) {
    console.warn("[ingredient-media] column introspection failed:", error?.message || error);
  }

  const availableColumns = new Set(existingColumns);

  for (const [columnName, definition] of columns) {
    if (availableColumns.has(columnName)) continue;

    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`Ingredient\` ADD COLUMN \`${columnName}\` ${definition}`
      );
      availableColumns.add(columnName);
    } catch (error) {
      const message = String(error?.message || error);
      const metaMessage = String(error?.meta?.message || "");
      if (!message.includes("Duplicate column name") && !metaMessage.includes("Duplicate column name")) {
        throw error;
      }
      availableColumns.add(columnName);
    }
  }

  if (!availableColumns.has("imageStatus")) return;

  try {
    await prisma.$executeRawUnsafe(
      "CREATE INDEX `Ingredient_imageStatus_idx` ON `Ingredient`(`imageStatus`)"
    );
  } catch (error) {
    const message = String(error?.message || error);
    const metaMessage = String(error?.meta?.message || "");
    if (
      !message.includes("Duplicate key name") &&
      !metaMessage.includes("Duplicate key name")
    ) {
      throw error;
    }
  }
}
