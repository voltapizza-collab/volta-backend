export async function ensureIngredientMediaColumns(prisma) {
  const columns = [
    ["description", "TEXT NULL"],
    ["image", "TEXT NULL"],
    ["imagePublicId", "VARCHAR(255) NULL"],
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

  for (const [columnName, definition] of columns) {
    if (existingColumns.has(columnName)) continue;

    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`Ingredient\` ADD COLUMN \`${columnName}\` ${definition}`
      );
    } catch (error) {
      const message = String(error?.message || error);
      const metaMessage = String(error?.meta?.message || "");
      if (!message.includes("Duplicate column name") && !metaMessage.includes("Duplicate column name")) {
        throw error;
      }
    }
  }
}
