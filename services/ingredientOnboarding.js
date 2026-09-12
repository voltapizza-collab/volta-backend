import { normalizeCanonicalKey, normalizeAliasInput } from "./ingredientSemanticAdmin.js";

export const ONBOARDING_LOCALES = ["es", "en", "it", "fr", "pt", "ar", "zh"];
const categoryKeys = {
  ACEITES_GRASAS_VINAGRES: "oils_fats_vinegars", AROMAS_Y_EXTRACTOS: "extras",
  CARNES: "meats", CREMAS_DULCES: "sweet_creams", EMBUTIDOS: "cured_meats",
  ENDULZANTES: "sweeteners", EXTRAS: "extras", FRUTAS: "fruits",
  HIERBAS_ESPECIAS: "herbs_spices", OTROS: "other", PESCADOS_Y_MARISCOS: "seafood",
  QUESOS: "cheeses", SALSAS: "sauces", SETAS: "mushrooms", VERDURAS: "vegetables",
};
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 160) => {
  if (typeof value !== "string") return "";
  const result = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (result.length > max || /\uFFFD|[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(result)) {
    fail("Revisa los nombres: hay caracteres dañados o un texto demasiado largo.");
  }
  return result;
};

export function normalizeIngredientOnboarding(body = {}) {
  const name = text(body.name, 120);
  const category = text(body.category, 80).toUpperCase();
  const canonicalKey = normalizeCanonicalKey(body.canonicalKey);
  if (!name || !categoryKeys[category] || !canonicalKey) fail("Selecciona un ingrediente válido de la lista maestra.");
  const input = Array.isArray(body.translations) ? body.translations : [];
  if (input.length !== ONBOARDING_LOCALES.length || new Set(input.map((item) => item?.locale)).size !== ONBOARDING_LOCALES.length) {
    fail("Completa los siete idiomas: español, inglés, italiano, francés, portugués, árabe y chino.");
  }
  const translations = ONBOARDING_LOCALES.map((locale) => {
    const translationName = text(input.find((item) => item?.locale === locale)?.name);
    if (!translationName) fail("Completa los siete idiomas antes de añadir el ingrediente.");
    if (locale === "es" && translationName !== name) fail("El nombre original debe coincidir con el nombre en español.");
    return { locale, name: translationName, isReviewed: locale === "es" };
  });
  const normalizedAliases = [...new Set([name, ...(Array.isArray(body.aliases) ? body.aliases : [])])]
    .slice(0, 30).map((alias) => normalizeAliasInput({ alias: text(alias), locale: "es",
      searchable: true, displayable: true, isReviewed: true, source: "MASTER_SOURCE" }));
  const aliases = [...new Map(normalizedAliases.map((alias) => [alias.normalizedAlias, alias])).values()];
  return { name, category, canonicalKey, translations, aliases,
    semanticCategoryKey: categoryKeys[category],
    allergens: [...new Set((Array.isArray(body.allergens) ? body.allergens : []).map((item) => text(item, 80)).filter(Boolean))].slice(0, 30),
  };
}

export async function createIngredientOnboarding(prisma, body, imageData = {}) {
  const data = normalizeIngredientOnboarding(body);
  try {
    return await prisma.$transaction(async (tx) => {
      const category = await tx.ingredientSemanticCategory.findUnique({ where: { canonicalKey: data.semanticCategoryKey }, select: { id: true } });
      if (!category) fail("La categoría de este ingrediente todavía no está preparada.", 409);
      const existing = await tx.ingredient.findMany({ where: { isSystem: true }, select: {
        id: true, canonicalKey: true, name: true, translations: { select: { name: true } }, aliases: { select: { alias: true } },
      } });
      const identityKeys = new Set([normalizeCanonicalKey(data.name), data.canonicalKey]);
      if (existing.some((item) => [item.name, item.canonicalKey,
        ...(item.translations || []).map((translation) => translation.name),
        ...(item.aliases || []).map((alias) => alias.alias)]
        .some((value) => value && identityKeys.has(normalizeCanonicalKey(value))))) {
        fail("Este ingrediente ya está añadido al catálogo global.", 409);
      }
      return tx.ingredient.create({ data: {
        name: data.name, category: data.category, canonicalKey: data.canonicalKey,
        allergens: data.allergens, isSystem: true, semanticStatus: "NEEDS_REVIEW", semanticCategoryId: category.id,
        translations: { create: data.translations }, aliases: { create: data.aliases },
        ...imageData,
      }, include: { translations: true, aliases: true } });
    }, { maxWait: 10000, timeout: 20000 });
  } catch (error) {
    if (error.code === "P2002") fail("Este ingrediente ya está añadido al catálogo global.", 409);
    throw error;
  }
}

// Upload before the database transaction: a failed upload must not create a partial ingredient.
export async function onboardIngredientWithImage({ prisma, body, file, uploadImage, deleteImage }) {
  normalizeIngredientOnboarding(body);
  let uploaded;
  try {
    if (file) uploaded = await uploadImage(file);
    return await createIngredientOnboarding(prisma, body, uploaded ? {
      image: uploaded.image, imagePublicId: uploaded.imagePublicId,
      imageStatus: "GENERATED", imageSource: "MANUAL_UPLOAD", imageVersion: 1,
      imagePolicyVersion: "v1", imageReviewedAt: null, imageReviewedBy: null,
    } : {});
  } catch (err) {
    if (uploaded?.imagePublicId) {
      await deleteImage(uploaded.imagePublicId).catch(() => {
        console.error("[ingredient-onboarding] Could not remove an unlinked uploaded image.");
      });
    }
    throw err;
  }
}
