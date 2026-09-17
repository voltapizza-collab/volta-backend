import { normalizeCanonicalKey, normalizeAliasInput } from "./ingredientSemanticAdmin.js";
import { normalizeSearchText } from "./ingredientSemantics.js";
import { ingredientMasterIdentityRules } from "../data/ingredientMasterIdentityRules.js";

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
  const inputKey = normalizeCanonicalKey(body.canonicalKey);
  const canonicalKey = Object.hasOwn(ingredientMasterIdentityRules.redirects, inputKey)
    ? ingredientMasterIdentityRules.redirects[inputKey] : inputKey;
  if (!name || !categoryKeys[category] || !canonicalKey) fail("Selecciona un ingrediente válido de la lista maestra.");
  if (ingredientMasterIdentityRules.pendingKeys.includes(canonicalKey)) {
    fail("Este ingrediente necesita aclarar su identidad antes de añadirlo al catálogo.", 409);
  }
  const legacyInput = body.legacyCanonicalKeys ?? [];
  if (!Array.isArray(legacyInput) || legacyInput.length > 30) fail("Revisa las referencias del ingrediente de la lista maestra.");
  const providedLegacyKeys = legacyInput.map((value) => {
    if (typeof value !== "string" || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value) || value.length > 120) {
      fail("Revisa las referencias del ingrediente de la lista maestra.");
    }
    return value;
  });
  const legacyCanonicalKeys = [...new Set([
    ...Object.entries(ingredientMasterIdentityRules.redirects).filter(([, target]) => target === canonicalKey).map(([key]) => key),
    ...providedLegacyKeys,
  ])].filter((value) => value !== canonicalKey);
  const input = Array.isArray(body.translations) ? body.translations : [];
  if (input.length !== ONBOARDING_LOCALES.length || new Set(input.map((item) => item?.locale)).size !== ONBOARDING_LOCALES.length) {
    fail("Completa los siete idiomas: español, inglés, italiano, francés, portugués, árabe y chino.");
  }
  const translations = ONBOARDING_LOCALES.map((locale) => {
    const translationName = text(input.find((item) => item?.locale === locale)?.name);
    if (!translationName) fail("Completa los siete idiomas antes de añadir el ingrediente.");
    if (locale === "es" && translationName !== name) fail("El nombre original debe coincidir con el nombre en español.");
    return { locale, name: translationName, isReviewed: body.confirmTranslations === true || locale === "es" };
  });
  const normalizedAliases = [...new Set([name, ...(Array.isArray(body.aliases) ? body.aliases : [])])]
    .slice(0, 30).map((alias) => normalizeAliasInput({ alias: text(alias), locale: "es",
      searchable: true, displayable: true, isReviewed: true, source: "MASTER_SOURCE" }));
  const aliases = [...new Map(normalizedAliases.map((alias) => [alias.normalizedAlias, alias])).values()];
  return { name, category, canonicalKey, legacyCanonicalKeys, translations, aliases,
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
      // Legacy master keys are lookup hints only: do not rewrite existing IDs or persist them as displayable aliases.
      const identityKeys = new Set([data.canonicalKey, ...data.legacyCanonicalKeys]);
      const nameKeys = new Set([data.name, ...data.aliases.map((alias) => alias.alias)].map(normalizeSearchText));
      if (existing.some((item) => identityKeys.has(item.canonicalKey) || [item.name,
        ...(item.translations || []).map((translation) => translation.name),
        ...(item.aliases || []).map((alias) => alias.alias)]
        .some((value) => value && nameKeys.has(normalizeSearchText(value))))) {
        fail("Este ingrediente ya está añadido al catálogo global.", 409);
      }
      return tx.ingredient.create({ data: {
        name: data.name, category: data.category, canonicalKey: data.canonicalKey,
        allergens: data.allergens, isSystem: true,
        semanticStatus: data.translations.every((translation) => translation.isReviewed) ? "REVIEWED" : "NEEDS_REVIEW",
        semanticCategoryId: category.id,
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
