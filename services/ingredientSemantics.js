const DEFAULT_FALLBACK_LOCALES = ["en", "es"];
const DEFAULT_MAX_DISPLAY_ALIASES = 6;

export const normalizeSearchText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const normalizeLocale = (locale) =>
  String(locale || "")
    .trim()
    .toLowerCase();

const uniqueValues = (values) => {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    const key = normalizeSearchText(clean);

    if (!clean || seen.has(key)) return;
    seen.add(key);
    result.push(clean);
  });

  return result;
};

const formatTechnicalCategory = (category) => {
  const clean = String(category || "").trim();
  if (!clean) return "Otros";

  return clean
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const orderedLocales = (locale, fallbackLocales = DEFAULT_FALLBACK_LOCALES) =>
  uniqueValues([locale, ...fallbackLocales].map(normalizeLocale));

const findReviewedTranslation = (translations, locales) => {
  const rows = Array.isArray(translations) ? translations : [];

  for (const locale of locales) {
    const match = rows.find(
      (row) =>
        row?.isReviewed === true &&
        normalizeLocale(row.locale) === locale &&
        String(row.name || "").trim()
    );

    if (match) return match;
  }

  return null;
};

const getReviewedCategoryTranslation = (category, locales) =>
  findReviewedTranslation(category?.translations, locales);

const getAliasRows = (ingredient) =>
  Array.isArray(ingredient?.aliases) ? ingredient.aliases : [];

const getReviewedTranslations = (translations) => {
  const seen = new Set();

  return (Array.isArray(translations) ? translations : []).reduce(
    (result, translation) => {
      const locale = normalizeLocale(translation?.locale);
      const name = String(translation?.name || "").trim();

      if (translation?.isReviewed !== true || !locale || !name || seen.has(locale)) {
        return result;
      }

      seen.add(locale);
      result.push({ locale, name });
      return result;
    },
    []
  );
};

const resolveAliases = (
  ingredient,
  { locale, country, fallbackLocales, maxDisplayAliases }
) => {
  const locales = new Set(orderedLocales(locale, fallbackLocales));
  const normalizedCountry = String(country || "").trim().toUpperCase();
  const rows = getAliasRows(ingredient);

  const scopedRows = rows.filter((row) => {
    const rowLocale = normalizeLocale(row?.locale);
    const rowCountry = String(row?.country || "").trim().toUpperCase();
    const localeMatches = !rowLocale || locales.has(rowLocale);
    const countryMatches = !rowCountry || !normalizedCountry || rowCountry === normalizedCountry;
    return localeMatches && countryMatches;
  });

  const searchAliases = uniqueValues(
    scopedRows
      .filter((row) => row?.searchable !== false)
      .map((row) => row.alias)
  );

  const displayAliases = uniqueValues(
    scopedRows
      .filter(
        (row) =>
          row?.displayable === true &&
          row?.isReviewed === true &&
          String(row.alias || "").trim()
      )
      .map((row) => row.alias)
  ).slice(0, maxDisplayAliases);

  return { searchAliases, displayAliases };
};

export const resolveCategoryDisplay = (
  ingredient,
  { locale = "es", fallbackLocales = DEFAULT_FALLBACK_LOCALES } = {}
) => {
  const locales = orderedLocales(locale, fallbackLocales);
  const category = ingredient?.semanticCategory;
  const translation = getReviewedCategoryTranslation(category, locales);

  if (translation?.name) {
    return {
      displayCategory: translation.name,
      categoryFallbackUsed: false,
    };
  }

  return {
    displayCategory:
      category?.defaultName ||
      formatTechnicalCategory(ingredient?.category),
    categoryFallbackUsed: true,
  };
};

export const resolveIngredientDisplay = (
  ingredient,
  {
    locale = "es",
    fallbackLocales = DEFAULT_FALLBACK_LOCALES,
    country = "",
    includeAliases = true,
    maxDisplayAliases = DEFAULT_MAX_DISPLAY_ALIASES,
  } = {}
) => {
  const locales = orderedLocales(locale, fallbackLocales);
  const translation = findReviewedTranslation(ingredient?.translations, locales);
  const categoryResolution = resolveCategoryDisplay(ingredient, {
    locale,
    fallbackLocales,
  });
  const aliasResolution = includeAliases
    ? resolveAliases(ingredient, {
        locale,
        country,
        fallbackLocales,
        maxDisplayAliases,
      })
    : { searchAliases: [], displayAliases: [] };

  const displayName =
    translation?.name ||
    String(ingredient?.name || "").trim() ||
    `Ingrediente ${ingredient?.id || ""}`.trim();

  const displayDescription =
    translation?.description ||
    ingredient?.description ||
    "";

  const searchText = buildIngredientSearchText(ingredient, {
    displayName,
    displayDescription,
    displayCategory: categoryResolution.displayCategory,
    searchAliases: aliasResolution.searchAliases,
  });

  return {
    displayName,
    displayDescription,
    displayCategory: categoryResolution.displayCategory,
    aliases: aliasResolution.displayAliases,
    searchAliases: aliasResolution.searchAliases,
    translations: getReviewedTranslations(ingredient?.translations),
    searchText,
    fallbackUsed: !translation,
    categoryFallbackUsed: categoryResolution.categoryFallbackUsed,
    semanticStatus: ingredient?.semanticStatus || "UNREVIEWED",
  };
};

export const buildIngredientSearchText = (
  ingredient,
  {
    displayName = "",
    displayDescription = "",
    displayCategory = "",
    searchAliases = [],
  } = {}
) =>
  normalizeSearchText(
    uniqueValues([
      displayName,
      ingredient?.name,
      ingredient?.canonicalKey,
      displayCategory,
      ingredient?.category,
      displayDescription,
      ingredient?.description,
      ...(Array.isArray(searchAliases) ? searchAliases : []),
      ...(Array.isArray(ingredient?.translations)
        ? ingredient.translations
            .filter((translation) => translation?.isReviewed === true)
            .flatMap((translation) => [
              translation.name,
              translation.description,
            ])
        : []),
    ]).join(" ")
  );
