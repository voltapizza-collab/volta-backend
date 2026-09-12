import { Prisma } from "@prisma/client";

export const PROFILE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS \`PartnerIngredientProfile\` (
  \`partnerId\` INTEGER NOT NULL,
  \`ingredientId\` INTEGER NOT NULL,
  \`costPrice\` DECIMAL(10,2) NOT NULL,
  \`description\` TEXT NULL,
  \`image\` TEXT NULL,
  \`imagePublicId\` VARCHAR(191) NULL,
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`partnerId\`, \`ingredientId\`),
  INDEX \`PartnerIngredientProfile_ingredientId_idx\` (\`ingredientId\`),
  CONSTRAINT \`PartnerIngredientProfile_partnerId_fkey\` FOREIGN KEY (\`partnerId\`) REFERENCES \`Partner\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`PartnerIngredientProfile_ingredientId_fkey\` FOREIGN KEY (\`ingredientId\`) REFERENCES \`Ingredient\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

const prepared = new WeakMap();
export const ensurePartnerIngredientProfiles = (prisma) => {
  if (!prepared.has(prisma)) {
    prepared.set(prisma, prisma.$executeRawUnsafe(PROFILE_TABLE_SQL).catch((err) => {
      prepared.delete(prisma); throw err;
    }));
  }
  return prepared.get(prisma);
};

const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
export const normalizePartnerIngredientProfile = (body = {}) => {
  const input = String(body.costPrice ?? "").trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(input) || Number(input) <= 0) {
    throw invalid("Introduce un precio mayor que cero, con un máximo de dos decimales.");
  }
  if (typeof body.description !== "string" || body.description.length > 420) {
    throw invalid("La descripción admite hasta 420 caracteres.");
  }
  return { costPrice: Number(input), description: body.description.trim() };
};

export const loadPartnerIngredientProfiles = async (prisma, partnerId) => {
  if (!Number.isInteger(Number(partnerId)) || Number(partnerId) <= 0) return new Map();
  await ensurePartnerIngredientProfiles(prisma);
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT ingredientId, costPrice, description, image, imagePublicId
    FROM PartnerIngredientProfile WHERE partnerId = ${Number(partnerId)}`);
  return new Map(rows.map((row) => [row.ingredientId, { ...row, costPrice: Number(row.costPrice) }]));
};

export const withPartnerIngredientProfile = (ingredient, profiles) => {
  const profile = profiles?.get(ingredient?.id);
  if (!profile) return ingredient;
  return { ...ingredient, costPrice: profile.costPrice, description: profile.description ?? ingredient.description,
    ...(profile.image ? { image: profile.image, imagePublicId: profile.imagePublicId,
      imageStatus: "GENERATED", imageSource: "MANUAL_UPLOAD" } : {}),
    hasPartnerProfile: true,
  };
};

// One business profile and the selected store's activation are saved atomically.
// Global ingredients, translations, aliases and allergens are never updated here.
export async function savePartnerIngredientProfile({ prisma, storeId, ingredientId, body, file, uploadImage, deleteImage }) {
  const data = normalizePartnerIngredientProfile(body);
  const [store, ingredient] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { partnerId: true } }),
    prisma.ingredient.findUnique({ where: { id: ingredientId }, select: { id: true, status: true } }),
  ]);
  if (!store || !ingredient) throw invalid("No se encontró la tienda o el ingrediente.", 404);
  if (ingredient.status !== "ACTIVE") throw invalid("El ingrediente no está disponible en el catálogo.", 409);
  await ensurePartnerIngredientProfiles(prisma);
  let uploaded;
  let previousImage;
  try {
    if (file) uploaded = await uploadImage(file, store.partnerId, ingredientId);
    await prisma.$transaction(async (tx) => {
      const old = await tx.$queryRaw(Prisma.sql`SELECT imagePublicId FROM PartnerIngredientProfile
        WHERE partnerId = ${store.partnerId} AND ingredientId = ${ingredientId} FOR UPDATE`);
      previousImage = old[0]?.imagePublicId;
      await tx.$executeRaw(Prisma.sql`INSERT INTO PartnerIngredientProfile
        (partnerId, ingredientId, costPrice, description, image, imagePublicId, updatedAt)
        VALUES (${store.partnerId}, ${ingredientId}, ${data.costPrice}, ${data.description},
          ${uploaded?.image || null}, ${uploaded?.imagePublicId || null}, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE costPrice = VALUES(costPrice), description = VALUES(description),
          image = COALESCE(VALUES(image), image), imagePublicId = COALESCE(VALUES(imagePublicId), imagePublicId),
          updatedAt = CURRENT_TIMESTAMP(3)`);
      await tx.storeIngredientStock.upsert({ where: { storeId_ingredientId: { storeId, ingredientId } },
        update: { active: true }, create: { storeId, ingredientId, stock: 0, active: true } });
    }, { maxWait: 10000, timeout: 20000 });
  } catch (err) {
    if (uploaded?.imagePublicId) await deleteImage(uploaded.imagePublicId).catch(() => {});
    throw err;
  }
  if (uploaded && previousImage && previousImage !== uploaded.imagePublicId) {
    await deleteImage(previousImage).catch(() => {});
  }
  return { ingredientId, partnerId: store.partnerId, active: true, ...data };
}
