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
    .toLowerCase()
    .replace("_", "-");

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

const expandLocale = (locale) => {
  const normalized = normalizeLocale(locale);
  if (!normalized) return [];

  const baseLocale = normalized.split("-")[0];
  return normalized === baseLocale ? [normalized] : [normalized, baseLocale];
};

const orderedLocales = (locale, fallbackLocales = DEFAULT_FALLBACK_LOCALES) =>
  uniqueValues([
    ...expandLocale(locale),
    ...fallbackLocales.flatMap(expandLocale),
  ]);

const isRequestedLocaleMatch = (translationLocale, requestedLocale) => {
  const translationLocales = new Set(expandLocale(translationLocale));
  return expandLocale(requestedLocale).some((locale) =>
    translationLocales.has(locale)
  );
};

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
    rows
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
    const resolvedLocale = normalizeLocale(translation.locale);

    return {
      displayCategory: translation.name,
      categoryResolvedLocale: resolvedLocale || null,
      categoryFallbackUsed: !isRequestedLocaleMatch(resolvedLocale, locale),
    };
  }

  return {
    displayCategory:
      category?.defaultName ||
      formatTechnicalCategory(ingredient?.category),
    categoryResolvedLocale: null,
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
  const resolvedLocale = translation ? normalizeLocale(translation.locale) : null;

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
    requestedLocale: normalizeLocale(locale) || null,
    resolvedLocale,
    fallbackUsed: !translation || !isRequestedLocaleMatch(resolvedLocale, locale),
    categoryFallbackUsed: categoryResolution.categoryFallbackUsed,
    categoryResolvedLocale: categoryResolution.categoryResolvedLocale,
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
