import { normalizeIngredientOnboarding } from './ingredientOnboarding.js';
import { findMasterIngredient, getMasterIngredient } from './ingredientMasterCatalogue.js';
import { normalizeSearchText } from './ingredientSemantics.js';

const fail = (message, status = 400, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
export const catalogInclude = { translations: true, aliases: true, catalogState: true };
const lockIngredient = (tx, id) => tx.$queryRawUnsafe('SELECT id FROM Ingredient WHERE id = ? FOR UPDATE', id);

export async function archiveCatalogIngredient(prisma, id, confirmed) {
  if (confirmed !== true) fail('Confirma que quieres devolver el ingrediente a la bolsa general.');
  return prisma.$transaction(async tx => {
    await lockIngredient(tx, id);
    const ingredient = await tx.ingredient.findUnique({ where: { id }, include: catalogInclude });
    if (!ingredient?.isSystem) fail('No se encontró el ingrediente del catálogo global.', 404);
    if (ingredient.catalogState?.archivedAt) return { ok: true, archived: true, id };
    const master = findMasterIngredient(ingredient);
    if (!master) fail('No se puede retirar: primero hay que vincular esta ficha con una identidad de la lista maestra.', 409);
    const counts = await Promise.all([
      tx.storeIngredientStock.count({ where: { ingredientId: id } }),
      tx.menuPizzaIngredient.count({ where: { ingredientId: id } }),
      tx.ingredientExtra.count({ where: { ingredientId: id } }),
      tx.ingredientCategoryUse.count({ where: { ingredientId: id } }),
      tx.partnerIngredientProfile.count({ where: { ingredientId: id } }),
      tx.ingredientLocalSemanticMapping.count({ where: { OR: [{ globalIngredientId: id }, { suggestedGlobalIngredientId: id }, { localIngredientId: id }] } }),
    ]);
    const usage = Object.fromEntries(['stores', 'products', 'extras', 'categoryUses', 'partnerProfiles', 'mappings'].map((key, index) => [key, counts[index]]));
    if (counts.some(count => count > 0)) fail('No se puede eliminar del panel: el ingrediente sigue vinculado a tiendas, recetas u otras configuraciones. Desvincúlalo antes de retirarlo.', 409, { usage });
    await tx.ingredientCatalogState.upsert({ where: { ingredientId: id },
      create: { ingredientId: id, masterCanonicalKey: master.canonicalKey, archivedAt: new Date(), previousStatus: ingredient.status },
      update: { archivedAt: new Date(), previousStatus: ingredient.status } });
    await tx.ingredient.update({ where: { id }, data: { status: 'INACTIVE' } });
    return { ok: true, archived: true, id, masterCanonicalKey: master.canonicalKey };
  }, { maxWait: 10000, timeout: 20000 });
}

export async function saveCatalogIngredient({ prisma, id, body, file, uploadImage, deleteImage, restore = false }) {
  const existing = await prisma.ingredient.findUnique({ where: { id }, include: catalogInclude });
  if (!existing?.isSystem) fail('No se encontró el ingrediente del catálogo global.', 404);
  const master = findMasterIngredient(existing);
  const canonicalKey = existing.canonicalKey || master?.canonicalKey;
  if (body.canonicalKey && body.canonicalKey !== canonicalKey && !(restore && body.canonicalKey === master?.canonicalKey)) {
    fail('La identidad del ingrediente está protegida. Editar la ficha no cambia la lista maestra.', 409);
  }
  if (existing.catalogState?.archivedAt && !restore) fail('Este ingrediente está en la bolsa general. Vuelve a añadirlo antes de editarlo.', 409);
  if (restore && (!master || !getMasterIngredient(body.canonicalKey))) fail('Selecciona la identidad original de la lista maestra.', 409);
  const data = normalizeIngredientOnboarding({ ...body, canonicalKey, confirmTranslations: true });
  if (!['ACTIVE', 'INACTIVE'].includes(body.status || 'ACTIVE')) fail('Estado del ingrediente no válido.');
  let uploaded;
  let saved;
  let replacedImagePublicId;
  try {
    if (file) uploaded = await uploadImage(file, id);
    saved = await prisma.$transaction(async tx => {
      await lockIngredient(tx, id);
      const current = await tx.ingredient.findUnique({ where: { id }, include: catalogInclude });
      if (!current?.isSystem || (!restore && current.catalogState?.archivedAt)) fail('La ficha ha cambiado. Recarga el catálogo.', 409);
      if (current.canonicalKey !== existing.canonicalKey) fail('La identidad ha cambiado. Recarga la ficha antes de guardar.', 409);
      replacedImagePublicId = current.imagePublicId;
      const otherIngredients = await tx.ingredient.findMany({ where: { isSystem: true, id: { not: id } },
        select: { name: true, aliases: { select: { alias: true } } } });
      const names = new Set([data.name, ...data.aliases.map(row => row.alias)].map(normalizeSearchText));
      if (otherIngredients.some(item => [item.name, ...(item.aliases || []).map(row => row.alias)].some(name => names.has(normalizeSearchText(name))))) {
        fail('Ese nombre ya identifica otro ingrediente del catálogo. Revisa los nombres antes de guardar.', 409);
      }
      const category = await tx.ingredientSemanticCategory.findUnique({ where: { canonicalKey: data.semanticCategoryKey }, select: { id: true } });
      if (!category) fail('La categoría todavía no está preparada.', 409);
      if (master) await tx.ingredientCatalogState.upsert({ where: { ingredientId: id },
        create: { ingredientId: id, masterCanonicalKey: master.canonicalKey },
        update: restore ? { archivedAt: null, previousStatus: null } : {} });
      for (const translation of data.translations) {
        const description = (body.translations || []).find(row => row.locale === translation.locale)?.description;
        const fields = { ...translation, ...(description !== undefined ? { description: String(description).slice(0, 800) } : {}) };
        await tx.ingredientTranslation.upsert({ where: { ingredientId_locale: { ingredientId: id, locale: translation.locale } },
          create: { ingredientId: id, ...fields }, update: fields });
      }
      // Retain saved regional aliases and their metadata; add only new names.
      for (const alias of data.aliases) {
        const found = await tx.ingredientAlias.findFirst({ where: { ingredientId: id, locale: alias.locale, normalizedAlias: alias.normalizedAlias } });
        if (!found) await tx.ingredientAlias.create({ data: { ingredientId: id, ...alias } });
      }
      return tx.ingredient.update({ where: { id }, data: {
        name: data.name, category: data.category, canonicalKey,
        semanticCategoryId: category.id, semanticStatus: 'REVIEWED',
        status: body.status || (restore ? current.catalogState?.previousStatus : current.status) || 'ACTIVE',
        ...(uploaded ? { image: uploaded.image, imagePublicId: uploaded.imagePublicId,
          imageStatus: 'GENERATED', imageSource: 'MANUAL_UPLOAD', imageVersion: (current.imageVersion || 0) + 1,
          imageReviewedAt: null, imageReviewedBy: null, imagePolicyVersion: 'v1' } : {}),
      }, include: catalogInclude });
    }, { maxWait: 10000, timeout: 20000 });
  } catch (error) {
    if (uploaded?.imagePublicId) await deleteImage(uploaded.imagePublicId).catch(() => {});
    throw error;
  }
  if (uploaded?.imagePublicId && replacedImagePublicId && uploaded.imagePublicId !== replacedImagePublicId) {
    await deleteImage(replacedImagePublicId).catch(() => console.warn('[ingredient-catalog] Old image cleanup pending.'));
  }
  return saved;
}
