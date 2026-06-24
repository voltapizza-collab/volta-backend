import { normalizeSearchText } from "./ingredientSemantics.js";

const SEMANTIC_STATUSES = new Set([
  "UNREVIEWED",
  "NEEDS_REVIEW",
  "REVIEWED",
  "REJECTED",
]);

export const CORE_REVIEW_LOCALES = ["es", "en", "it"];

const normalizeText = (value, max = 400) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export const normalizeLocaleCode = (value) => {
  const locale = normalizeText(value, 16).toLowerCase().replace(/_/g, "-");
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(locale)) return null;
  return locale;
};

export const normalizeCountryCode = (value) => {
  const country = normalizeText(value, 2).toUpperCase();
  if (!country) return null;
  if (!/^[A-Z]{2}$/.test(country)) return null;
  return country;
};

export const normalizeSemanticStatus = (value) => {
  const status = normalizeText(value, 32).toUpperCase();
  if (!status) return undefined;
  if (!SEMANTIC_STATUSES.has(status)) {
    const error = new Error("Invalid semantic status");
    error.status = 400;
    throw error;
  }
  return status;
};

export const normalizeCanonicalKey = (value) => {
  const key = normalizeText(value, 120)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return key || null;
};

export const normalizeTranslationInput = (translation) => {
  const locale = normalizeLocaleCode(translation?.locale);
  const name = normalizeText(translation?.name, 160);
  const description = normalizeText(translation?.description, 800) || null;

  if (!locale || !name) {
    const error = new Error("Translation locale and name are required");
    error.status = 400;
    throw error;
  }

  return {
    locale,
    name,
    description,
    isReviewed: translation?.isReviewed === true,
  };
};

export const normalizeAliasInput = (alias) => {
  const locale = alias?.locale ? normalizeLocaleCode(alias.locale) : null;
  const country = alias?.country ? normalizeCountryCode(alias.country) : null;
  const value = normalizeText(alias?.alias, 160);
  const normalizedAlias = normalizeSearchText(value);

  if (!value || !normalizedAlias) {
    const error = new Error("Alias is required");
    error.status = 400;
    throw error;
  }

  return {
    locale,
    country,
    alias: value,
    normalizedAlias,
    searchable: alias?.searchable !== false,
    displayable: alias?.displayable === true,
    isReviewed: alias?.isReviewed === true,
    source: normalizeText(alias?.source, 40).toUpperCase() || "MANUAL",
  };
};

export const normalizeSemanticsPayload = (body = {}) => {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(body, "canonicalKey")) {
    payload.canonicalKey = normalizeCanonicalKey(body.canonicalKey);
  }

  if (Object.prototype.hasOwnProperty.call(body, "semanticStatus")) {
    payload.semanticStatus = normalizeSemanticStatus(body.semanticStatus);
  }

  if (Object.prototype.hasOwnProperty.call(body, "semanticCategoryId")) {
    if (body.semanticCategoryId === null || body.semanticCategoryId === "") {
      payload.semanticCategoryId = null;
    } else {
      const semanticCategoryId = Number(body.semanticCategoryId);
      if (!Number.isInteger(semanticCategoryId) || semanticCategoryId <= 0) {
        const error = new Error("Invalid semantic category id");
        error.status = 400;
        throw error;
      }
      payload.semanticCategoryId = semanticCategoryId;
    }
  }

  payload.translations = Array.isArray(body.translations)
    ? body.translations.map(normalizeTranslationInput)
    : [];
  payload.aliases = Array.isArray(body.aliases)
    ? body.aliases.map(normalizeAliasInput)
    : [];

  return payload;
};

export const getSemanticReviewGaps = ({
  canonicalKey,
  semanticCategoryId,
  translations = [],
} = {}) => {
  const reviewedLocales = new Set(
    translations
      .filter(
        (translation) =>
          translation?.isReviewed === true &&
          normalizeText(translation?.name, 160)
      )
      .map((translation) => normalizeLocaleCode(translation.locale))
      .filter(Boolean)
  );
  const missingCoreLocales = CORE_REVIEW_LOCALES.filter(
    (locale) => !reviewedLocales.has(locale)
  );
  const gaps = [];

  if (!canonicalKey) gaps.push("canonicalKey");
  if (!semanticCategoryId) gaps.push("semanticCategoryId");
  missingCoreLocales.forEach((locale) => gaps.push(`translation:${locale}`));

  return { gaps, missingCoreLocales };
};

export const resolveProtectedSemanticStatus = ({
  requestedStatus,
  canonicalKey,
  semanticCategoryId,
  translations = [],
} = {}) => {
  const status = requestedStatus || "UNREVIEWED";
  if (status === "REJECTED") return status;

  const { gaps } = getSemanticReviewGaps({
    canonicalKey,
    semanticCategoryId,
    translations,
  });

  if (gaps.length > 0) return "NEEDS_REVIEW";
  return status;
};
