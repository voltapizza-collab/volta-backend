const LEGACY_CATEGORY_TO_SEMANTIC_KEY = {
  ACEITES: "oils_fats_vinegars",
  ACEITES_GRASAS_VINAGRES: "oils_fats_vinegars",
  AROMAS_Y_EXTRACTOS: "herbs_spices",
  CARNES: "meats",
  CREMAS_DULCES: "sweet_creams",
  EMBUTIDOS: "cured_meats",
  ENDULZANTES: "sweeteners",
  ESPECIAS: "herbs_spices",
  EXTRAS: "extras",
  FIAMBRES: "cured_meats",
  FRUTAS: "fruits",
  FRUTOS_SECOS_Y_SEMILLAS: "nuts_seeds",
  HIERBAS_ESPECIAS: "herbs_spices",
  MARISCOS: "seafood",
  OTROS: "other",
  PESCADOS: "seafood",
  PESCADOS_Y_MARISCOS: "seafood",
  PROTEINA_VEGANA: "vegan_protein",
  QUESOS: "cheeses",
  SALSAS: "sauces",
  SALSAS_CREMAS: "sauces",
  SETAS: "mushrooms",
  TOPPINGS_DULCES: "extras",
  VERDURAS: "vegetables",
};

export const normalizeLegacyIngredientCategory = (category) =>
  String(category || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const resolveSemanticCategoryKey = (category) => {
  const normalized = normalizeLegacyIngredientCategory(category);
  if (!normalized) return null;

  return LEGACY_CATEGORY_TO_SEMANTIC_KEY[normalized] || null;
};

export const getLegacySemanticCategoryMap = () => ({
  ...LEGACY_CATEGORY_TO_SEMANTIC_KEY,
});
