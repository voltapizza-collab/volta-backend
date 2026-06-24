import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { ensureIngredientMediaColumns } from "../services/ingredientMediaColumns.js";
import { assertCloudinaryConfigured } from "../services/cloudinaryConfig.js";
import { ensureIngredientSemanticsAvailable } from "../services/ingredientSemanticsColumns.js";
import {
  normalizeSemanticsPayload,
  resolveProtectedSemanticStatus,
} from "../services/ingredientSemanticAdmin.js";
import { resolveIngredientDisplay } from "../services/ingredientSemantics.js";
import {
  suggestLocalSemanticMapping,
  suggestLocalSemanticMappings,
} from "../services/ingredientLocalSemantics.js";
import prisma from "../services/prisma.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const parseMaybeJson = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeText = (value, max = 400) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const normalizeIngredientIdentityKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeLocaleParam = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace("_", "-")
    .split("-")[0] || null;

const normalizeAllergens = (value) => {
  const parsed = parseMaybeJson(value, value);
  return Array.isArray(parsed)
    ? parsed.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
};

const uploadIngredientImage = async (file, ingredientId) => {
  if (!file) return null;

  assertCloudinaryConfigured();

  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    { folder: `volta/ingredients/${ingredientId}` }
  );

  return {
    image: result.secure_url,
    imagePublicId: result.public_id,
  };
};

const ALLOWED_IMAGE_SOURCES = new Set([
  "MANUAL_UPLOAD",
  "AI_GENERATED",
  "LICENSED_PROVIDER",
]);

const normalizeImageSource = (source = "MANUAL_UPLOAD") => {
  const normalized = normalizeText(source, 80).toUpperCase();
  return ALLOWED_IMAGE_SOURCES.has(normalized) ? normalized : "MANUAL_UPLOAD";
};

const buildIngredientImageDraftData = (source = "MANUAL_UPLOAD", prompt = "") => ({
  imageStatus: "GENERATED",
  imageSource: normalizeImageSource(source),
  imagePrompt: normalizeText(prompt, 2000) || null,
  imageReviewedAt: null,
  imageReviewedBy: null,
  imageVersion: { increment: 1 },
  imagePolicyVersion: "v1",
});

const ALLOWED_IMAGE_STATUSES = new Set([
  "MISSING",
  "GENERATED",
  "REVIEWED",
  "REJECTED",
  "DEPRECATED",
]);

const normalizeImageStatus = (value) => {
  const status = String(value || "").trim().toUpperCase();

  if (!ALLOWED_IMAGE_STATUSES.has(status)) {
    const error = new Error("Invalid ingredient image status");
    error.status = 400;
    throw error;
  }

  return status;
};

const getErrorStatus = (err, fallback = 400) => {
  if (err?.status) return err.status;
  if (err?.code === "P2002") return 409;
  if (["P1001", "P1002", "P1017"].includes(err?.code)) return 503;
  return fallback;
};

const ingredientSemanticInclude = {
  translations: {
    orderBy: { locale: "asc" },
  },
  aliases: {
    orderBy: [{ locale: "asc" }, { alias: "asc" }],
  },
  semanticCategory: {
    include: {
      translations: {
        orderBy: { locale: "asc" },
      },
    },
  },
};

const semanticCategoryInclude = {
  translations: {
    orderBy: { locale: "asc" },
  },
};

const requireIngredientSemantics = async () => {
  const available = await ensureIngredientSemanticsAvailable(prisma);

  if (!available) {
    const error = new Error("Ingredient semantics migration is not available");
    error.status = 409;
    throw error;
  }
};

const mapSemanticIngredient = (ingredient, locale = "es") => {
  if (!ingredient) return null;

  const semantic = resolveIngredientDisplay(ingredient, { locale });
  const { translations, aliases, _count, semanticCategory, ...rest } = ingredient;

  return {
    ...rest,
    displayName: semantic.displayName,
    displayCategory: semantic.displayCategory,
    semanticCategoryKey: semanticCategory?.canonicalKey || null,
    searchText: semantic.searchText,
    requestedLocale: semantic.requestedLocale,
    resolvedLocale: semantic.resolvedLocale,
    fallbackUsed: semantic.fallbackUsed,
    semanticTranslations: translations || [],
    semanticAliases: aliases || [],
    translationCount: _count?.translations || 0,
    aliasCount: _count?.aliases || 0,
  };
};

const parseIngredientId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("Invalid ingredient id");
    error.status = 400;
    throw error;
  }
  return id;
};

const ingredientLegacySelect = {
  id: true,
  name: true,
  category: true,
  allergens: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
  isSystem: true,
  stock: true,
  unit: true,
  costPrice: true,
  description: true,
  image: true,
  imagePublicId: true,
  imageStatus: true,
  imageSource: true,
  imagePrompt: true,
  imageReviewedAt: true,
  imageReviewedBy: true,
  imageVersion: true,
  imagePolicyVersion: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

router.get("/", async (req, res) => {
  try {
    await ensureIngredientMediaColumns(prisma);
    const semanticsEnabled = await ensureIngredientSemanticsAvailable(prisma);

    const ingredients = await prisma.ingredient.findMany({
      where: { isSystem: true },
      orderBy: { createdAt: "desc" },
      select: {
        ...ingredientLegacySelect,
        ...(semanticsEnabled
          ? {
              canonicalKey: true,
              semanticStatus: true,
              semanticCategoryId: true,
              translations: {
                select: {
                  locale: true,
                  name: true,
                  description: true,
                  isReviewed: true,
                },
              },
              aliases: {
                select: {
                  locale: true,
                  country: true,
                  alias: true,
                  searchable: true,
                  displayable: true,
                  isReviewed: true,
                },
              },
              semanticCategory: {
                select: {
                  canonicalKey: true,
                  defaultName: true,
                  translations: {
                    select: {
                      locale: true,
                      name: true,
                      isReviewed: true,
                    },
                  },
                },
              },
              _count: {
                select: {
                  translations: true,
                  aliases: true,
                },
              },
            }
          : {}),
      },
    });

    const activeStoreWhere = {
      active: true,
      partner: { active: true },
    };
    const [activeStoreTotal, usageRows, productUsageRows] = await Promise.all([
      prisma.store.count({ where: activeStoreWhere }),
      prisma.storeIngredientStock.groupBy({
        by: ["ingredientId"],
        where: {
          active: true,
          store: activeStoreWhere,
          ingredient: { isSystem: true },
        },
        _count: {
          storeId: true,
        },
      }),
      prisma.menuPizzaIngredient.groupBy({
        by: ["ingredientId"],
        where: {
          ingredient: { isSystem: true },
          menuPizza: {
            status: "ACTIVE",
            partner: { active: true },
          },
        },
        _count: {
          menuPizzaId: true,
        },
      }),
    ]);
    const usageByIngredientId = new Map(
      usageRows.map((row) => [
        row.ingredientId,
        Number(row._count?.storeId || 0),
      ])
    );
    const productUsageByIngredientId = new Map(
      productUsageRows.map((row) => [
        row.ingredientId,
        Number(row._count?.menuPizzaId || 0),
      ])
    );
    const addUsageStats = (ingredient) => {
      const usageStoreCount = usageByIngredientId.get(ingredient.id) || 0;
      const usageStorePercent = activeStoreTotal
        ? Math.round((usageStoreCount / activeStoreTotal) * 100)
        : 0;
      const usageProductCount = productUsageByIngredientId.get(ingredient.id) || 0;

      return {
        ...ingredient,
        usageStoreCount,
        usageStorePercent,
        usageStoreTotal: activeStoreTotal,
        usageProductCount,
      };
    };

    res.json(
      ingredients
        .map((ingredient) => {
          const { _count, translations, aliases, ...rest } = ingredient;

          if (!semanticsEnabled) return addUsageStats(rest);
          const semantic = resolveIngredientDisplay(ingredient, {
            locale: normalizeLocaleParam(req.query.locale) || "es",
          });

          return addUsageStats({
            ...rest,
            displayName: semantic.displayName,
            displayDescription: semantic.displayDescription,
            displayCategory: semantic.displayCategory,
            displayAliases: semantic.aliases,
            searchAliases: semantic.searchAliases,
            searchText: semantic.searchText,
            requestedLocale: semantic.requestedLocale,
            resolvedLocale: semantic.resolvedLocale,
            fallbackUsed: semantic.fallbackUsed,
            categoryResolvedLocale: semantic.categoryResolvedLocale,
            categoryFallbackUsed: semantic.categoryFallbackUsed,
            semanticTranslations: translations || [],
            semanticAliases: aliases || [],
            translationCount: _count?.translations || 0,
            aliasCount: _count?.aliases || 0,
          });
        })
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error fetching ingredients" });
  }
});

router.get("/semantic-categories", async (_req, res) => {
  try {
    await requireIngredientSemantics();

    const categories = await prisma.ingredientSemanticCategory.findMany({
      include: semanticCategoryInclude,
      orderBy: [{ position: "asc" }, { defaultName: "asc" }],
    });

    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({
      error: err.message || "error fetching semantic categories",
    });
  }
});

router.get("/local-semantic-mappings", async (req, res) => {
  try {
    await requireIngredientSemantics();

    const locale = normalizeLocaleParam(req.query.locale) || "es";
    const globalIngredientSelect = {
      ...ingredientLegacySelect,
      canonicalKey: true,
      semanticStatus: true,
      semanticCategoryId: true,
      translations: {
        select: {
          locale: true,
          name: true,
          description: true,
          isReviewed: true,
        },
      },
      aliases: {
        select: {
          locale: true,
          country: true,
          alias: true,
          searchable: true,
          displayable: true,
          isReviewed: true,
        },
      },
      semanticCategory: {
        select: {
          canonicalKey: true,
          defaultName: true,
          translations: {
            select: {
              locale: true,
              name: true,
              isReviewed: true,
            },
          },
        },
      },
      _count: {
        select: {
          translations: true,
          aliases: true,
        },
      },
    };

    const [localIngredients, globalIngredients] = await Promise.all([
      prisma.ingredient.findMany({
        where: { isSystem: false },
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        select: {
          ...ingredientLegacySelect,
          localSemanticMapping: {
            include: {
              globalIngredient: {
                select: globalIngredientSelect,
              },
            },
          },
          _count: {
            select: {
              menuPizzas: true,
              ingredientExtras: true,
              categoryUses: true,
              storeStocks: true,
            },
          },
        },
      }),
      prisma.ingredient.findMany({
        where: {
          isSystem: true,
          semanticStatus: "REVIEWED",
          canonicalKey: { not: null },
        },
        orderBy: [{ name: "asc" }],
        select: globalIngredientSelect,
      }),
    ]);

    const globalOptions = globalIngredients.map((ingredient) =>
      mapSemanticIngredient(ingredient, locale)
    );

    res.json({
      localIngredients: localIngredients.map((ingredient) => {
        const mapping = ingredient.localSemanticMapping;
        const { localSemanticMapping, _count, ...rest } = ingredient;
        const suggestedMappings = mapping
          ? []
          : suggestLocalSemanticMappings(rest, globalOptions, 3);
        const suggestedMapping =
          suggestedMappings[0] || suggestLocalSemanticMapping(rest, globalOptions);
        const suggestionAlternatives = suggestedMappings.slice(1);
        const suggestionScoreGap =
          suggestedMappings.length > 1
            ? suggestedMappings[0].score - suggestedMappings[1].score
            : null;

        return {
          ...rest,
          usageCount:
            (_count?.menuPizzas || 0) +
            (_count?.ingredientExtras || 0) +
            (_count?.categoryUses || 0) +
            (_count?.storeStocks || 0),
          usageBreakdown: {
            menuPizzas: _count?.menuPizzas || 0,
            ingredientExtras: _count?.ingredientExtras || 0,
            categoryUses: _count?.categoryUses || 0,
            storeStocks: _count?.storeStocks || 0,
          },
          semanticMapping: mapping
            ? {
                id: mapping.id,
                status: mapping.status,
                notes: mapping.notes,
                source: mapping.source,
                suggestedGlobalIngredientId: mapping.suggestedGlobalIngredientId,
                suggestionScore: mapping.suggestionScore,
                suggestionConfidence: mapping.suggestionConfidence,
                suggestionReasons: Array.isArray(mapping.suggestionReasons)
                  ? mapping.suggestionReasons
                  : [],
                acceptedAt: mapping.acceptedAt,
                acceptedBy: mapping.acceptedBy,
                globalIngredientId: mapping.globalIngredientId,
                globalIngredient: mapSemanticIngredient(
                  mapping.globalIngredient,
                  locale
                ),
              }
            : null,
          suggestedMapping: suggestedMapping
            ? {
                score: suggestedMapping.score,
                confidence: suggestedMapping.confidence,
                reasons: suggestedMapping.reasons,
                isAmbiguous:
                  suggestedMapping.confidence !== "HIGH" ||
                  (suggestionScoreGap != null && suggestionScoreGap < 12),
                scoreGap: suggestionScoreGap,
                globalIngredientId: suggestedMapping.ingredient.id,
                globalIngredient: suggestedMapping.ingredient,
              }
            : null,
          suggestionAlternatives: suggestionAlternatives.map((suggestion) => ({
            score: suggestion.score,
            confidence: suggestion.confidence,
            reasons: suggestion.reasons,
            globalIngredientId: suggestion.ingredient.id,
            globalIngredient: suggestion.ingredient,
          })),
        };
      }),
      globalOptions,
    });
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({
      error: err.message || "error fetching local semantic mappings",
    });
  }
});

router.patch("/local-semantic-mappings/:localIngredientId", async (req, res) => {
  try {
    await requireIngredientSemantics();

    const localIngredientId = parseIngredientId(req.params.localIngredientId);
    const globalIngredientId = parseIngredientId(req.body.globalIngredientId);
    const status = String(req.body.status || "MAPPED").trim().toUpperCase();
    const notes = normalizeText(req.body.notes, 600) || null;
    const source = String(req.body.source || "MANUAL").trim().toUpperCase();
    const acceptedBy = normalizeText(req.body.acceptedBy, 160) || null;
    const suggestionScore =
      req.body.suggestionScore == null || req.body.suggestionScore === ""
        ? null
        : Number(req.body.suggestionScore);
    const suggestionConfidence = normalizeText(req.body.suggestionConfidence, 40) || null;
    const suggestionReasons = Array.isArray(req.body.suggestionReasons)
      ? req.body.suggestionReasons
          .map((reason) => normalizeText(reason, 160))
          .filter(Boolean)
      : null;
    const suggestedGlobalIngredientId =
      req.body.suggestedGlobalIngredientId == null ||
      req.body.suggestedGlobalIngredientId === ""
        ? null
        : parseIngredientId(req.body.suggestedGlobalIngredientId);

    if (!["MAPPED", "NEEDS_REVIEW"].includes(status)) {
      return res.status(400).json({ error: "Invalid local mapping status" });
    }

    if (!["MANUAL", "SUGGESTED_ACCEPTED"].includes(source)) {
      return res.status(400).json({ error: "Invalid local mapping source" });
    }

    if (
      suggestionScore != null &&
      (!Number.isInteger(suggestionScore) || suggestionScore < 0 || suggestionScore > 100)
    ) {
      return res.status(400).json({ error: "Invalid suggestion score" });
    }

    const [localIngredient, globalIngredient, suggestedGlobalIngredient] = await Promise.all([
      prisma.ingredient.findUnique({
        where: { id: localIngredientId },
        select: { id: true, isSystem: true },
      }),
      prisma.ingredient.findUnique({
        where: { id: globalIngredientId },
        select: {
          id: true,
          isSystem: true,
          canonicalKey: true,
          semanticStatus: true,
        },
      }),
      suggestedGlobalIngredientId
        ? prisma.ingredient.findUnique({
            where: { id: suggestedGlobalIngredientId },
            select: {
              id: true,
              isSystem: true,
              canonicalKey: true,
              semanticStatus: true,
            },
          })
        : null,
    ]);

    if (!localIngredient) {
      return res.status(404).json({ error: "Local ingredient not found" });
    }

    if (localIngredient.isSystem) {
      return res.status(400).json({
        error: "Only local ingredients can be mapped to a global identity",
      });
    }

    if (!globalIngredient) {
      return res.status(404).json({ error: "Global ingredient not found" });
    }

    if (
      !globalIngredient.isSystem ||
      globalIngredient.semanticStatus !== "REVIEWED" ||
      !globalIngredient.canonicalKey
    ) {
      return res.status(400).json({
        error: "Mapping target must be a reviewed global ingredient",
      });
    }

    if (source === "SUGGESTED_ACCEPTED") {
      if (!suggestedGlobalIngredientId) {
        return res.status(400).json({
          error: "Suggested accepted mappings require suggestedGlobalIngredientId",
        });
      }

      if (suggestedGlobalIngredientId !== globalIngredientId) {
        return res.status(400).json({
          error: "Accepted suggestion must match selected global ingredient",
        });
      }

      if (
        !suggestedGlobalIngredient ||
        !suggestedGlobalIngredient.isSystem ||
        suggestedGlobalIngredient.semanticStatus !== "REVIEWED" ||
        !suggestedGlobalIngredient.canonicalKey
      ) {
        return res.status(400).json({
          error: "Suggested target must be a reviewed global ingredient",
        });
      }
    }

    const decisionTrace =
      source === "SUGGESTED_ACCEPTED"
        ? {
            suggestedGlobalIngredientId,
            suggestionScore,
            suggestionConfidence,
            suggestionReasons: suggestionReasons || [],
            acceptedAt: new Date(),
            acceptedBy,
          }
        : {
            suggestedGlobalIngredientId: null,
            suggestionScore: null,
            suggestionConfidence: null,
            suggestionReasons: null,
            acceptedAt: null,
            acceptedBy,
          };

    const mapping = await prisma.ingredientLocalSemanticMapping.upsert({
      where: { localIngredientId },
      update: {
        globalIngredientId,
        status,
        notes,
        source,
        ...decisionTrace,
      },
      create: {
        localIngredientId,
        globalIngredientId,
        status,
        notes,
        source,
        ...decisionTrace,
      },
    });

    res.json(mapping);
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({
      error: err.message || "error updating local semantic mapping",
    });
  }
});

router.delete("/local-semantic-mappings/:localIngredientId", async (req, res) => {
  try {
    await requireIngredientSemantics();

    const localIngredientId = parseIngredientId(req.params.localIngredientId);

    await prisma.ingredientLocalSemanticMapping.deleteMany({
      where: { localIngredientId },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({
      error: err.message || "error deleting local semantic mapping",
    });
  }
});

router.get("/:id/semantics", async (req, res) => {
  try {
    await requireIngredientSemantics();

    const id = parseIngredientId(req.params.id);
    const ingredient = await prisma.ingredient.findUnique({
      where: { id },
      include: ingredientSemanticInclude,
    });

    if (!ingredient) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    if (!ingredient.isSystem) {
      return res.status(403).json({
        error: "Ingredient is local and is not part of the global semantic catalog",
      });
    }

    res.json(ingredient);
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({
      error: err.message || "error fetching ingredient semantics",
    });
  }
});

router.patch("/:id/semantics", async (req, res) => {
  try {
    await requireIngredientSemantics();

    const id = parseIngredientId(req.params.id);
    const payload = normalizeSemanticsPayload(req.body);

    const existing = await prisma.ingredient.findUnique({
      where: { id },
      select: {
        id: true,
        isSystem: true,
        canonicalKey: true,
        semanticStatus: true,
        semanticCategoryId: true,
        translations: {
          select: {
            locale: true,
            name: true,
            isReviewed: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    if (!existing.isSystem) {
      return res.status(403).json({
        error: "Ingredient is local and is not part of the global semantic catalog",
      });
    }

    if (payload.semanticCategoryId) {
      const category = await prisma.ingredientSemanticCategory.findUnique({
        where: { id: payload.semanticCategoryId },
        select: { id: true },
      });

      if (!category) {
        return res.status(400).json({ error: "Semantic category not found" });
      }
    }

    const mergedTranslations = new Map(
      (existing.translations || []).map((translation) => [
        translation.locale,
        translation,
      ])
    );
    payload.translations.forEach((translation) => {
      mergedTranslations.set(translation.locale, translation);
    });

    const finalCanonicalKey = Object.prototype.hasOwnProperty.call(
      payload,
      "canonicalKey"
    )
      ? payload.canonicalKey
      : existing.canonicalKey;
    const finalSemanticCategoryId = Object.prototype.hasOwnProperty.call(
      payload,
      "semanticCategoryId"
    )
      ? payload.semanticCategoryId
      : existing.semanticCategoryId;
    const finalSemanticStatus = resolveProtectedSemanticStatus({
      requestedStatus: Object.prototype.hasOwnProperty.call(
        payload,
        "semanticStatus"
      )
        ? payload.semanticStatus
        : existing.semanticStatus,
      canonicalKey: finalCanonicalKey,
      semanticCategoryId: finalSemanticCategoryId,
      translations: [...mergedTranslations.values()],
    });

    const ingredientData = {};
    ["canonicalKey", "semanticCategoryId"].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        ingredientData[field] = payload[field];
      }
    });
    ingredientData.semanticStatus = finalSemanticStatus;

    const ingredient = await prisma.$transaction(
      async (tx) => {
        if (Object.keys(ingredientData).length) {
          await tx.ingredient.update({
            where: { id },
            data: ingredientData,
          });
        }

        for (const translation of payload.translations) {
          await tx.ingredientTranslation.upsert({
            where: {
              ingredientId_locale: {
                ingredientId: id,
                locale: translation.locale,
              },
            },
            update: {
              name: translation.name,
              description: translation.description,
              isReviewed: translation.isReviewed,
            },
            create: {
              ingredientId: id,
              ...translation,
            },
          });
        }

        for (const alias of payload.aliases) {
          const existingAlias = await tx.ingredientAlias.findFirst({
            where: {
              ingredientId: id,
              locale: alias.locale,
              normalizedAlias: alias.normalizedAlias,
            },
            select: { id: true },
          });

          if (existingAlias) {
            await tx.ingredientAlias.update({
              where: { id: existingAlias.id },
              data: alias,
            });
          } else {
            await tx.ingredientAlias.create({
              data: {
                ingredientId: id,
                ...alias,
              },
            });
          }
        }

        return tx.ingredient.findUnique({
          where: { id },
          include: ingredientSemanticInclude,
        });
      },
      { maxWait: 10000, timeout: 20000 }
    );

    res.json(ingredient);
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({
      error: err.message || "error updating ingredient semantics",
    });
  }
});

router.patch("/:id/image-review", async (req, res) => {
  try {
    await ensureIngredientMediaColumns(prisma);

    const id = parseIngredientId(req.params.id);
    const imageStatus = normalizeImageStatus(req.body.imageStatus);
    const reviewer = normalizeText(req.body.reviewedBy, 160) || "global-manager";
    const imagePolicyVersion = normalizeText(req.body.imagePolicyVersion, 40) || "v1";

    const existing = await prisma.ingredient.findUnique({
      where: { id },
      select: {
        id: true,
        isSystem: true,
        image: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    if (!existing.isSystem) {
      return res.status(403).json({
        error: "Only global ingredients can use global image review",
      });
    }

    if (imageStatus === "REVIEWED" && !existing.image) {
      return res.status(400).json({
        error: "Cannot approve a missing ingredient image",
      });
    }

    const reviewData =
      imageStatus === "REVIEWED"
        ? {
            imageReviewedAt: new Date(),
            imageReviewedBy: reviewer,
            imagePolicyVersion,
          }
        : {
            imageReviewedAt: null,
            imageReviewedBy: null,
            imagePolicyVersion,
          };

    const ingredient = await prisma.ingredient.update({
      where: { id },
      data: {
        imageStatus,
        ...reviewData,
      },
      select: ingredientLegacySelect,
    });

    res.json(ingredient);
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({
      error: err.message || "error updating ingredient image review",
    });
  }
});

router.get("/suggestions", async (req, res) => {
  try {
    const { status } = req.query;

    const where = {};

    if (status) {
      where.status = status.toUpperCase();
    }

    const suggestions = await prisma.ingredientSuggestion.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching suggestions" });
  }
});
router.post("/", upload.single("image"), async (req, res) => {
  try {
    await ensureIngredientMediaColumns(prisma);

    const { name, category, allergens, description } = req.body;

    if (!name || !category) {
      return res.status(400).json({
        error: "name and category required",
      });
    }

    const ingredientName = normalizeText(name, 120);
    const ingredientCategory = normalizeText(category, 80).toUpperCase();
    const ingredientIdentityKey = normalizeIngredientIdentityKey(ingredientName);
    const existingIngredients = await prisma.ingredient.findMany({
      where: { isSystem: true },
      select: { id: true, name: true, canonicalKey: true },
    });
    const duplicate = existingIngredients.find((ingredient) =>
      [ingredient.name, ingredient.canonicalKey].some(
        (value) =>
          normalizeIngredientIdentityKey(value) &&
          normalizeIngredientIdentityKey(value) === ingredientIdentityKey
      )
    );

    if (duplicate) {
      return res.status(409).json({
        error: "Ingredient already exists in the global catalog",
        ingredientId: duplicate.id,
      });
    }

    const ingredient = await prisma.$transaction(async (tx) => {
      const created = await tx.ingredient.create({
        data: {
          name: ingredientName,
          category: ingredientCategory,
          allergens: normalizeAllergens(allergens),
          description: normalizeText(description, 420) || null,
          isSystem: true,
        },
        select: ingredientLegacySelect,
      });

      return created;
    });

    if (!req.file) {
      return res.json(ingredient);
    }

    let uploadedImage = null;

    try {
      uploadedImage = await uploadIngredientImage(req.file, ingredient.id);
      const updated = await prisma.ingredient.update({
        where: { id: ingredient.id },
        data: {
          ...uploadedImage,
          ...buildIngredientImageDraftData(
            req.body.imageSource,
            req.body.imagePrompt
          ),
        },
        select: ingredientLegacySelect,
      });
      return res.json(updated);
    } catch (uploadError) {
      if (uploadedImage?.imagePublicId) {
        await cloudinary.uploader.destroy(uploadedImage.imagePublicId).catch(() => {});
      }
      throw uploadError;
    }
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({ error: err.message || "error creating ingredient" });
  }
});

router.patch("/:id", upload.single("image"), async (req, res) => {
  try {
    await ensureIngredientMediaColumns(prisma);

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid ingredient id" });
    }

    const data = {};

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      const name = normalizeText(req.body.name, 120);
      if (!name) {
        return res.status(400).json({ error: "Invalid ingredient name" });
      }
      data.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "category")) {
      const category = normalizeText(req.body.category, 80).toUpperCase();
      if (!category) {
        return res.status(400).json({ error: "Invalid ingredient category" });
      }
      data.category = category;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
      data.description = normalizeText(req.body.description, 420) || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "allergens")) {
      data.allergens = normalizeAllergens(req.body.allergens);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "costPrice")) {
      if (req.body.costPrice === "" || req.body.costPrice == null) {
        data.costPrice = null;
      } else {
        const costPrice = Number(req.body.costPrice);

        if (!Number.isFinite(costPrice) || costPrice < 0) {
          return res.status(400).json({ error: "Invalid ingredient price" });
        }

        data.costPrice = Math.round(costPrice * 100) / 100;
      }
    }

    const existing = await prisma.ingredient.findUnique({
      where: { id },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    let uploadedImage = null;

    if (req.file) {
      uploadedImage = await uploadIngredientImage(req.file, id);
      Object.assign(
        data,
        uploadedImage,
        buildIngredientImageDraftData(req.body.imageSource, req.body.imagePrompt)
      );
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const ingredient = await prisma.ingredient.update({
      where: { id },
      data,
      select: ingredientLegacySelect,
    });

    if (uploadedImage?.imagePublicId && existing.imagePublicId) {
      await cloudinary.uploader.destroy(existing.imagePublicId).catch((error) => {
        console.error("Cloudinary old ingredient image cleanup failed:", error);
      });
    }

    res.json(ingredient);
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({ error: err.message || "error updating ingredient" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid ingredient id" });
    }

    const existing = await prisma.ingredient.findUnique({
      where: { id },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    await prisma.$transaction([
      prisma.storeIngredientStock.deleteMany({
        where: { ingredientId: id },
      }),
      prisma.menuPizzaIngredient.deleteMany({
        where: { ingredientId: id },
      }),
      prisma.ingredientExtra.deleteMany({
        where: { ingredientId: id },
      }),
      prisma.ingredient.delete({
        where: { id },
      }),
    ]);

    if (existing.imagePublicId) {
      assertCloudinaryConfigured();
      await cloudinary.uploader.destroy(existing.imagePublicId).catch((error) => {
        console.error("Cloudinary ingredient image cleanup failed:", error);
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error deleting ingredient" });
  }
});
router.post("/suggestions", async (req, res) => {
  try {
    const { name, category } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: "Missing data" });
    }

    const cleanName = name.trim().toLowerCase();

    // 🔥 evitar duplicado en ingredientes reales
    const existing = await prisma.ingredient.findFirst({
      where: {
        name: cleanName,
      },
    });

    if (existing) {
      return res.status(400).json({
        error: "Ingredient already exists",
      });
    }

    // 🔥 evitar duplicado en sugerencias pendientes
    const existingSuggestion = await prisma.ingredientSuggestion.findFirst({
      where: {
        name: cleanName,
        status: "PENDING",
      },
    });

    if (existingSuggestion) {
      return res.status(400).json({
        error: "Suggestion already submitted",
      });
    }

    const suggestion = await prisma.ingredientSuggestion.create({
      data: {
        name: cleanName,
        category: category.toUpperCase(),
      },
    });

    res.json(suggestion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creating suggestion" });
  }
});
router.patch("/suggestions/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;

    const suggestion = await prisma.ingredientSuggestion.findUnique({
      where: { id: Number(id) },
    });

    if (!suggestion) {
      return res.status(404).json({ error: "Not found" });
    }

    // 🔥 crear ingrediente real
    const result = await prisma.$transaction(async (tx) => {
      const updatedSuggestion = await tx.ingredientSuggestion.update({
        where: { id: Number(id) },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
        },
      });

      const existingIngredient = await tx.ingredient.findFirst({
        where: { name: suggestion.name },
        select: { id: true },
      });

      const ingredient = existingIngredient
        ? await tx.ingredient.update({
            where: { id: existingIngredient.id },
            data: { status: "ACTIVE" },
            select: ingredientLegacySelect,
          })
        : await tx.ingredient.create({
            data: {
              name: suggestion.name,
              category: suggestion.category,
              allergens: [],
              isSystem: true,
            },
            select: ingredientLegacySelect,
          });

      return { suggestion: updatedSuggestion, ingredient };
    });

    // 🔥 marcar como aprobado
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error approving suggestion" });
  }
});
router.patch("/suggestions/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.ingredientSuggestion.update({
      where: { id: Number(id) },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error rejecting suggestion" });
  }
});

export default router;
