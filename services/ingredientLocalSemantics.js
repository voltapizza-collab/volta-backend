import { normalizeSearchText } from "./ingredientSemantics.js";

const LOCAL_NOISE_TOKENS = new Set([
  "demo",
  "local",
  "premium",
  "extra",
  "kg",
  "kilo",
  "kilos",
  "gr",
  "g",
  "unidad",
  "pack",
]);

const LOCAL_CATEGORY_TO_SEMANTIC_KEYS = {
  CHEESE: ["cheeses"],
  QUESOS: ["cheeses"],
  SAUCE: ["sauces"],
  SALSAS: ["sauces"],
  VEGETABLE: ["vegetables", "mushrooms"],
  VERDURAS: ["vegetables", "mushrooms"],
  PROTEIN: ["meats", "cured_meats", "vegan_protein", "seafood"],
  CARNES: ["meats", "cured_meats"],
};

const tokenize = (value) =>
  normalizeSearchText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !LOCAL_NOISE_TOKENS.has(token));

const uniqueTokens = (value) => [...new Set(tokenize(value))];

const buildCandidateValues = (candidate = {}) => [
  candidate.displayName,
  candidate.name,
  String(candidate.canonicalKey || "").replace(/_/g, " "),
  candidate.displayCategory,
  candidate.searchText,
  ...(Array.isArray(candidate.semanticTranslations)
    ? candidate.semanticTranslations.map((translation) => translation.name)
    : []),
  ...(Array.isArray(candidate.semanticAliases)
    ? candidate.semanticAliases.map((alias) => alias.alias)
    : []),
];

const getCategoryBonus = (localIngredient = {}, candidate = {}) => {
  const localCategory = String(localIngredient.category || "").trim().toUpperCase();
  const acceptedKeys = LOCAL_CATEGORY_TO_SEMANTIC_KEYS[localCategory] || [];

  if (!acceptedKeys.length) return 0;
  if (acceptedKeys.includes(candidate.semanticCategoryKey)) return 12;
  return 0;
};

const getDomainHintBonus = (localIngredient = {}, candidate = {}) => {
  const localCategory = String(localIngredient.category || "").trim().toUpperCase();
  const localTokens = uniqueTokens(localIngredient.name);

  if (
    ["SAUCE", "SALSAS"].includes(localCategory) &&
    (localTokens.includes("tomate") || localTokens.includes("tomato")) &&
    candidate.canonicalKey === "tomato_sauce"
  ) {
    return {
      score: 34,
      reason: "tomato sauce signal",
    };
  }

  if (
    ["VEGETABLE", "VERDURAS"].includes(localCategory) &&
    (localTokens.includes("tomate") || localTokens.includes("tomato")) &&
    candidate.canonicalKey === "fresh_tomato"
  ) {
    return {
      score: 28,
      reason: "fresh tomato signal",
    };
  }

  return { score: 0, reason: "" };
};

const scoreCandidate = (localIngredient, candidate) => {
  const localTokens = uniqueTokens(localIngredient.name);
  const localNormalized = localTokens.join(" ");
  const candidateValues = buildCandidateValues(candidate);
  const candidateText = normalizeSearchText(candidateValues.join(" "));
  const candidateTokens = uniqueTokens(candidateText);

  if (!localNormalized || !candidateTokens.length) {
    return { score: 0, reasons: [] };
  }

  const reasons = [];
  let score = 0;

  const exactCandidateValue = candidateValues.some(
    (value) => tokenize(value).join(" ") === localNormalized
  );

  if (exactCandidateValue) {
    score += 84;
    reasons.push("exact name/alias match");
  }

  if (!exactCandidateValue && candidateText.includes(localNormalized)) {
    score += 68;
    reasons.push("candidate text contains local name");
  }

  const normalizedDisplayName = normalizeSearchText(candidate.displayName);
  if (
    !exactCandidateValue &&
    normalizedDisplayName &&
    localNormalized.includes(normalizedDisplayName)
  ) {
    score += 56;
    reasons.push("local name contains global name");
  }

  const candidateTokenSet = new Set(candidateTokens);
  const overlap = localTokens.filter((token) => candidateTokenSet.has(token));
  const overlapRatio = overlap.length / localTokens.length;

  if (overlap.length > 0) {
    score += Math.round(overlapRatio * 52);
    reasons.push(`${overlap.length}/${localTokens.length} tokens matched`);
  }

  const categoryBonus = getCategoryBonus(localIngredient, candidate);
  if (categoryBonus > 0) {
    score += categoryBonus;
    reasons.push("category compatible");
  }

  const domainHint = getDomainHintBonus(localIngredient, candidate);
  if (domainHint.score > 0) {
    score += domainHint.score;
    reasons.push(domainHint.reason);
  }

  const canonicalTokens = uniqueTokens(String(candidate.canonicalKey || "").replace(/_/g, " "));
  const canonicalOverlap = localTokens.filter((token) =>
    canonicalTokens.includes(token)
  );

  if (canonicalOverlap.length > 0) {
    score += 8;
    reasons.push("canonical key overlap");
  }

  return {
    score: Math.min(100, score),
    rawScore: score,
    reasons,
  };
};

export const suggestLocalSemanticMappings = (
  localIngredient,
  globalCandidates = [],
  limit = 3
) =>
  globalCandidates
    .map((candidate) => {
      const result = scoreCandidate(localIngredient, candidate);
      return {
        ingredient: candidate,
        score: result.score,
        rawScore: result.rawScore,
        confidence:
          result.score >= 85 ? "HIGH" : result.score >= 62 ? "MEDIUM" : "LOW",
        reasons: result.reasons,
      };
    })
    .filter((candidate) => candidate.score >= 45)
    .sort((a, b) => b.rawScore - a.rawScore || String(a.ingredient.name || "").localeCompare(
      String(b.ingredient.name || ""),
      "es",
      { sensitivity: "base" }
    ))
    .slice(0, limit);

export const suggestLocalSemanticMapping = (
  localIngredient,
  globalCandidates = []
) => {
  const candidates = suggestLocalSemanticMappings(localIngredient, globalCandidates, 1);

  return candidates[0] || null;
};
