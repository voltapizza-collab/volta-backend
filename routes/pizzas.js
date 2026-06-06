import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { assertCloudinaryConfigured } from "../services/cloudinaryConfig.js";
import {
  assertIngredientsCanBeActivated,
  ensureStoreIngredientsActive,
  ensureStoresBelongToPartner,
} from "../services/storeMenuActivation.js";

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

const parseLaunchAt = (value) => {
  if (value == null || value === "") return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const PRODUCT_TAGS = new Set([
  "spicy",
  "vegan",
]);

const parseProductTags = (value) => {
  const parsed = parseMaybeJson(value, []);

  if (!Array.isArray(parsed)) return [];

  return [
    ...new Set(
      parsed
        .map((tag) => String(tag || "").trim())
        .filter((tag) => PRODUCT_TAGS.has(tag))
    ),
  ];
};

const normalizeBaseLabel = (value) => {
  const clean = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  return clean || "Tradicional";
};

const getCategoryOrThrow = async (prisma, rawCategoryId) => {
  const categoryId = Number(rawCategoryId);

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    const error = new Error("Invalid categoryId");
    error.status = 400;
    throw error;
  }

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });

  if (!category) {
    const error = new Error("Category not found");
    error.status = 404;
    throw error;
  }

  return category;
};

const normalizePositiveIds = (values) => [
  ...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  ),
];

const parseStoreIdsInput = (value) => {
  const parsed = parseMaybeJson(value, value);

  if (Array.isArray(parsed)) return parsed;
  if (parsed == null || parsed === "") return [];

  return [parsed];
};

const getTargetStoreIds = async (prisma, { partnerId, storeId, storeIds }) => {
  const hasExplicitStoreScope = storeIds != null && storeIds !== "";
  const targetStoreIds = normalizePositiveIds(
    hasExplicitStoreScope ? parseStoreIdsInput(storeIds) : parseStoreIdsInput(storeId)
  );

  return ensureStoresBelongToPartner(prisma, {
    partnerId,
    storeIds: targetStoreIds,
  });
};

const zeroStockForNewPizza = async (
  prisma,
  pizzaId,
  partnerId,
  activeStoreIds = []
) => {
  const stores = await prisma.store.findMany({
    where: { partnerId },
    select: { id: true },
  });

  if (!stores.length) return;

  const activeStoreIdSet = new Set(normalizePositiveIds(activeStoreIds));

  await prisma.storePizzaStock.createMany({
    data: stores.map((store) => ({
      storeId: store.id,
      pizzaId,
      stock: 0,
      active: activeStoreIdSet.has(store.id),
    })),
    skipDuplicates: true,
  });
};

const assertIngredientsAvailableForStores = async (
  prisma,
  partnerId,
  targetStoreIds,
  ingredients
) => {
  if (!targetStoreIds.length) return [];

  const ingredientIds = [...new Set(
    (Array.isArray(ingredients) ? ingredients : [])
      .map((item) => Number(item?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  await ensureStoresBelongToPartner(prisma, {
    partnerId,
    storeIds: targetStoreIds,
  });
  await assertIngredientsCanBeActivated(prisma, ingredientIds);

  return ingredientIds;
};

const syncIngredientCategoryUsesForCategory = async (
  prismaClient,
  {
    partnerId,
    categoryId,
  }
) => {
  const parsedPartnerId = Number(partnerId);
  const parsedCategoryId = Number(categoryId);

  if (
    !Number.isInteger(parsedPartnerId) ||
    parsedPartnerId <= 0 ||
    !Number.isInteger(parsedCategoryId) ||
    parsedCategoryId <= 0
  ) {
    return;
  }

  const recipeRows = await prismaClient.menuPizzaIngredient.findMany({
    where: {
      menuPizza: {
        partnerId: parsedPartnerId,
        categoryId: parsedCategoryId,
        status: "ACTIVE",
        type: "SELLABLE",
      },
      ingredient: {
        status: "ACTIVE",
      },
    },
    select: {
      ingredientId: true,
      ingredient: {
        select: { costPrice: true },
      },
    },
  });

  const ingredientsById = new Map();
  recipeRows.forEach((row) => {
    if (!ingredientsById.has(row.ingredientId)) {
      ingredientsById.set(row.ingredientId, row.ingredient?.costPrice ?? null);
    }
  });
  const ingredientIds = [...ingredientsById.keys()];

  if (!ingredientIds.length) return;

  await prismaClient.ingredientCategoryUse.createMany({
    data: ingredientIds.map((ingredientId) => ({
      partnerId: parsedPartnerId,
      categoryId: parsedCategoryId,
      ingredientId,
      costPrice: ingredientsById.get(ingredientId),
      active: true,
    })),
    skipDuplicates: true,
  });

  await prismaClient.ingredientCategoryUse.updateMany({
    where: {
      partnerId: parsedPartnerId,
      categoryId: parsedCategoryId,
      ingredientId: { in: ingredientIds },
    },
    data: { active: true },
  });
};

const mapPizza = (pizza) => ({
  ...pizza,
  categoryId: pizza.categoryId ?? null,
  categoryName: pizza.category ?? null,
  category: pizza.category ?? null,
  productTags: Array.isArray(pizza.productTags) ? pizza.productTags : [],
  ingredients: (pizza.ingredients || []).map((rel) => ({
    id: rel.ingredientId,
    name: rel.ingredient?.name,
    allergens: rel.ingredient?.allergens || [],
    qtyBySize: rel.qtyBySize,
    status: rel.ingredient?.status,
  })),
});

const isUnknownArgumentError = (err, argName) =>
  typeof err?.message === "string" &&
  err.message.includes(`Unknown argument \`${argName}\``);

const canUseCategoryId = (err) =>
  !(
    isUnknownArgumentError(err, "categoryId") ||
    typeof err?.message === "string" &&
      err.message.includes("Argument `categoryId`") ||
    typeof err?.message === "string" &&
      err.message.includes("Unknown arg `categoryId`")
  );

const uploadPizzaImage = async (file, partnerId) => {
  if (!file) return { image: null, imagePublicId: null };

  assertCloudinaryConfigured();

  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    { folder: `volta/partners/${partnerId}/pizzas` }
  );

  return {
    image: result.secure_url,
    imagePublicId: result.public_id,
  };
};

const assertImageUploadWasMultipart = (req) => {
  const hasSerializedImage =
    req.body &&
    Object.prototype.hasOwnProperty.call(req.body, "image") &&
    req.body.image != null &&
    req.body.image !== "";

  if (!req.file && hasSerializedImage) {
    const error = new Error("Image upload must use multipart/form-data");
    error.status = 415;
    throw error;
  }
};

const getRequestBody = (req) =>
  req.body && typeof req.body === "object" ? req.body : {};

const getErrorStatus = (err, fallback = 400) => {
  if (err?.status) return err.status;
  if (["P1001", "P1002", "P1017"].includes(err?.code)) return 503;
  return fallback;
};

const getErrorCode = (err) => {
  if (err?.code === "IMAGE_UPLOAD_NOT_CONFIGURED") {
    return "image_upload_not_configured";
  }

  if (["P1001", "P1002", "P1017"].includes(err?.code)) {
    return "database_unavailable";
  }

  const message = String(err?.message || "");
  if (
    message.includes("Can't reach database server") ||
    message.includes("Server has closed the connection")
  ) {
    return "database_unavailable";
  }

  return undefined;
};

const sendError = (res, err, fallback = 400) => {
  const code = getErrorCode(err);
  res.status(getErrorStatus(err, fallback)).json({
    error: err.message,
    ...(code ? { code } : {}),
  });
};

const normalizeTextKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isExcludedOverviewCategory = (value) => {
  const key = normalizeTextKey(value);
  return key === "bebidas" || key === "complementos";
};

const isExcludedTopIngredient = (value) => {
  const key = normalizeTextKey(value);
  return key.includes("tomate") || key.includes("mozzarella") || key.includes("mozarella");
};

const getSaleLineQty = (item) => {
  const qty = Number(item?.quantity ?? item?.qty ?? item?.cantidad ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
};

const getSaleLinePizzaId = (item, pizzaIdByName) => {
  const directId = Number(item?.pizzaId ?? item?.menuPizzaId ?? item?.productId);
  if (Number.isInteger(directId) && directId > 0) return directId;

  const nameKey = normalizeTextKey(
    item?.name || item?.pizzaName || item?.title || item?.productName
  );
  return pizzaIdByName.get(nameKey) || null;
};

export default function pizzasRoutes(prisma) {
  router.get("/overview", async (req, res) => {
    try {
      const partnerId = req.query.partnerId
        ? Number(req.query.partnerId)
        : null;

      if (!Number.isInteger(partnerId) || partnerId <= 0) {
        return res.status(400).json({ error: "Valid partnerId required" });
      }

      const [pizzas, stores, sales] = await Promise.all([
        prisma.menuPizza.findMany({
          where: {
            partnerId,
            type: "SELLABLE",
          },
          orderBy: { createdAt: "desc" },
          include: {
            ingredients: { include: { ingredient: true } },
          },
        }),
        prisma.store.findMany({
          where: { partnerId },
          select: { id: true, storeName: true, slug: true },
          orderBy: { storeName: "asc" },
        }),
        prisma.sale.findMany({
          where: {
            partnerId,
            status: { not: "CANCELED" },
          },
          select: {
            storeId: true,
            products: true,
            date: true,
            createdAt: true,
          },
          orderBy: { date: "desc" },
        }),
      ]);

      const relevantPizzas = pizzas.filter(
        (pizza) => !isExcludedOverviewCategory(pizza.category)
      );
      const pizzaIdByName = new Map(
        relevantPizzas.map((pizza) => [normalizeTextKey(pizza.name), pizza.id])
      );
      const pizzaById = new Map(relevantPizzas.map((pizza) => [pizza.id, pizza]));
      const categoryMap = new Map();

      relevantPizzas.forEach((pizza) => {
        const categoryId = Number(pizza.categoryId);
        const key = Number.isInteger(categoryId) && categoryId > 0
          ? `id:${categoryId}`
          : `name:${pizza.category || "Sin categoria"}`;
        const current =
          categoryMap.get(key) || {
            categoryId: Number.isInteger(categoryId) ? categoryId : null,
            name: pizza.category || "Sin categoria",
            active: 0,
            inactive: 0,
            total: 0,
          };

        if (pizza.status === "INACTIVE") current.inactive += 1;
        else current.active += 1;
        current.total += 1;
        categoryMap.set(key, current);
      });

      const ingredientMap = new Map();
      relevantPizzas.forEach((pizza) => {
        (pizza.ingredients || []).forEach((rel) => {
          const ingredientName = rel.ingredient?.name || `Ingrediente ${rel.ingredientId}`;
          if (isExcludedTopIngredient(ingredientName)) return;

          const key = rel.ingredientId || ingredientName;
          const qtyBySize = rel.qtyBySize || {};
          const totalQty = Object.values(qtyBySize).reduce(
            (sum, value) => sum + Number(value || 0),
            0
          );
          const current =
            ingredientMap.get(key) || {
              id: rel.ingredientId,
              name: ingredientName,
              pizzas: 0,
              totalQty: 0,
            };

          current.pizzas += 1;
          current.totalQty += totalQty;
          ingredientMap.set(key, current);
        });
      });

      const storeTopMap = new Map(
        stores.map((store) => [
          store.id,
          {
            storeId: store.id,
            storeName: store.storeName,
            products: new Map(),
          },
        ])
      );

      sales.forEach((sale) => {
        const storeRow = storeTopMap.get(sale.storeId);
        if (!storeRow) return;

        const products = Array.isArray(sale.products) ? sale.products : [];
        products.forEach((item) => {
          const pizzaId = getSaleLinePizzaId(item, pizzaIdByName);
          if (!pizzaId || !pizzaById.has(pizzaId)) return;

          const pizza = pizzaById.get(pizzaId);
          const current =
            storeRow.products.get(pizzaId) || {
              pizzaId,
              name: pizza.name,
              qty: 0,
            };

          current.qty += getSaleLineQty(item);
          storeRow.products.set(pizzaId, current);
        });
      });

      const categories = [...categoryMap.values()].sort(
        (left, right) => right.total - left.total || left.name.localeCompare(right.name, "es")
      );
      const topIngredients = [...ingredientMap.values()]
        .sort(
          (left, right) =>
            right.pizzas - left.pizzas ||
            right.totalQty - left.totalQty ||
            left.name.localeCompare(right.name, "es")
        )
        .slice(0, 5);
      const topPizzaByStore = [...storeTopMap.values()].map((store) => {
        const topProduct = [...store.products.values()].sort(
          (left, right) => right.qty - left.qty || left.name.localeCompare(right.name, "es")
        )[0];

        return {
          storeId: store.storeId,
          storeName: store.storeName,
          topPizza: topProduct || null,
        };
      });
      const newestPizza = relevantPizzas
        .filter((pizza) => pizza.createdAt)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0];

      return res.json({
        categories,
        topIngredients,
        topPizzaByStore,
        latestProduct: newestPizza
          ? {
              id: newestPizza.id,
              name: newestPizza.name,
              category: newestPizza.category,
              status: newestPizza.status,
              createdAt: newestPizza.createdAt,
            }
          : null,
        totals: {
          active: relevantPizzas.filter((pizza) => pizza.status !== "INACTIVE").length,
          inactive: relevantPizzas.filter((pizza) => pizza.status === "INACTIVE").length,
          total: relevantPizzas.length,
        },
      });
    } catch (err) {
      console.error("GET /pizzas/overview error:", err);
      res.status(500).json({ error: "Error fetching pizza overview" });
    }
  });

  router.get("/", async (req, res) => {
    try {
      const partnerId = req.query.partnerId
        ? Number(req.query.partnerId)
        : null;

      const pizzas = await prisma.menuPizza.findMany({
        where: {
          ...(partnerId ? { partnerId } : {}),
          type: "SELLABLE",
        },
        orderBy: { id: "desc" },
        include: {
          ingredients: { include: { ingredient: true } },
        },
      });

      res.json(pizzas.map(mapPizza));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error fetching pizzas" });
    }
  });

  router.post("/", upload.single("image"), async (req, res) => {
    try {
      const body = getRequestBody(req);
      const {
        name,
        partnerId,
        storeId,
        storeIds,
        categoryId,
        baseName,
        sizes,
        priceBySize,
        cookingMethod,
        ingredients,
        launchAt,
        availableUntil,
        productTags,
      } = body;

      assertImageUploadWasMultipart(req);

      if (!name || !partnerId || !categoryId) {
        return res.status(400).json({
          error: "Name, partnerId and categoryId required",
        });
      }

      const parsedPartnerId = Number(partnerId);
      if (!Number.isInteger(parsedPartnerId) || parsedPartnerId <= 0) {
        return res.status(400).json({ error: "Invalid partnerId" });
      }

      const partner = await prisma.partner.findUnique({
        where: { id: parsedPartnerId },
        select: { id: true },
      });

      if (!partner) {
        return res.status(404).json({ error: "Partner not found" });
      }

      const category = await getCategoryOrThrow(prisma, categoryId);
      const parsedSizes = parseMaybeJson(sizes, []);
      const parsedPrices = parseMaybeJson(priceBySize, {});
      const parsedIngredients = parseMaybeJson(ingredients, []);
      const targetStoreIds = await getTargetStoreIds(prisma, {
        partnerId: parsedPartnerId,
        storeId,
        storeIds,
      });

      const ingredientIds = await assertIngredientsAvailableForStores(
        prisma,
        parsedPartnerId,
        targetStoreIds,
        parsedIngredients
      );

      const ingredientRelations = parsedIngredients
        .filter((x) => Number(x?.id))
        .map((x) => ({
          ingredient: { connect: { id: Number(x.id) } },
          qtyBySize: x.qtyBySize || {},
        }));

      const { image, imagePublicId } = await uploadPizzaImage(
        req.file,
        parsedPartnerId
      );

      const createData = {
        name: String(name).trim(),
        partnerId: parsedPartnerId,
        categoryId: category.id,
        category: category.name,
        selectSize: parsedSizes,
        priceBySize: parsedPrices,
        cookingMethod: normalizeBaseLabel(baseName || cookingMethod),
        launchAt: parseLaunchAt(launchAt),
        availableUntil: parseLaunchAt(availableUntil),
        productTags: parseProductTags(productTags),
        image,
        imagePublicId,
        ingredients: { create: ingredientRelations },
      };

      let pizza;

      try {
        pizza = await prisma.menuPizza.create({
          data: createData,
        });
      } catch (err) {
        if (canUseCategoryId(err)) {
          throw err;
        }

        const { categoryId: _ignoredCategoryId, ...fallbackData } = createData;

        pizza = await prisma.menuPizza.create({
          data: fallbackData,
        });
      }

      const createdPizza = await prisma.menuPizza.findUnique({
        where: { id: pizza.id },
        include: {
          ingredients: { include: { ingredient: true } },
        },
      });

      await zeroStockForNewPizza(
        prisma,
        pizza.id,
        parsedPartnerId,
        targetStoreIds
      );
      await ensureStoreIngredientsActive(prisma, {
        storeIds: targetStoreIds,
        ingredientIds,
      });
      await syncIngredientCategoryUsesForCategory(prisma, {
        partnerId: parsedPartnerId,
        categoryId: category.id,
      });

      res.json(mapPizza(createdPizza || pizza));
    } catch (err) {
      console.error("POST /pizzas error:", err);
      sendError(res, err);
    }
  });

  router.put("/:id", upload.single("image"), async (req, res) => {
    try {
      const body = getRequestBody(req);
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });

      const existing = await prisma.menuPizza.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({ error: "Pizza not found" });
      }

      assertImageUploadWasMultipart(req);

      const parsedSizes = parseMaybeJson(body.sizes, []);
      const parsedPrices = parseMaybeJson(body.priceBySize, {});
      const parsedIngredients = parseMaybeJson(body.ingredients, []);
      const targetStoreIds = await getTargetStoreIds(prisma, {
        partnerId: existing.partnerId,
        storeId: body.storeId,
        storeIds: body.storeIds,
      });
      const nextBaseName = normalizeBaseLabel(
        body.baseName || body.cookingMethod || existing.cookingMethod
      );

      const targetIngredientIds = await assertIngredientsAvailableForStores(
        prisma,
        existing.partnerId,
        targetStoreIds,
        parsedIngredients
      );

      let nextCategoryId = existing.categoryId ?? null;
      let nextCategoryName = existing.category ?? null;
      let nextImage = existing.image ?? null;
      let nextImagePublicId = existing.imagePublicId ?? null;

      if (body.categoryId != null && body.categoryId !== "") {
        const category = await getCategoryOrThrow(prisma, body.categoryId);
        nextCategoryId = category.id;
        nextCategoryName = category.name;
      }

      let uploadedImage = null;

      if (req.file) {
        uploadedImage = await uploadPizzaImage(req.file, existing.partnerId);
        nextImage = uploadedImage.image;
        nextImagePublicId = uploadedImage.imagePublicId;
      }

      const updateData = {
        name: body.name?.trim() ?? existing.name,
        categoryId: nextCategoryId,
        category: nextCategoryName,
        selectSize: parsedSizes,
        priceBySize: parsedPrices,
        cookingMethod: nextBaseName,
        launchAt: parseLaunchAt(body.launchAt),
        availableUntil: parseLaunchAt(body.availableUntil),
        productTags: parseProductTags(body.productTags),
        image: nextImage,
        imagePublicId: nextImagePublicId,
      };

      const ingredientRows = parsedIngredients
        .filter((x) => Number(x?.id))
        .map((x) => ({
          menuPizzaId: id,
          ingredientId: Number(x.id),
          qtyBySize: x.qtyBySize || {},
        }));

      const existingIngredientCount = await prisma.menuPizzaIngredient.count({
        where: { menuPizzaId: id },
      });

      if (
        existingIngredientCount > 0 &&
        ingredientRows.length === 0 &&
        body.allowEmptyIngredients !== "true"
      ) {
        const error = new Error(
          "Refusing to clear existing product ingredients without explicit confirmation"
        );
        error.status = 409;
        throw error;
      }

      try {
        await prisma.$transaction(async (tx) => {
          try {
            await tx.menuPizza.update({
              where: { id },
              data: updateData,
            });
          } catch (err) {
            if (canUseCategoryId(err)) {
              throw err;
            }

            const { categoryId: _ignoredCategoryId, ...fallbackData } = updateData;

            await tx.menuPizza.update({
              where: { id },
              data: fallbackData,
            });
          }

          await tx.menuPizzaIngredient.deleteMany({
            where: { menuPizzaId: id },
          });

          if (ingredientRows.length) {
            await tx.menuPizzaIngredient.createMany({
              data: ingredientRows,
            });
          }
        });

        if (uploadedImage?.imagePublicId && existing.imagePublicId) {
          await cloudinary.uploader.destroy(existing.imagePublicId).catch((error) => {
            console.error("Cloudinary old pizza image cleanup failed:", error);
          });
        }
      } catch (err) {
        if (uploadedImage?.imagePublicId) {
          await cloudinary.uploader.destroy(uploadedImage.imagePublicId).catch((error) => {
            console.error("Cloudinary new pizza image rollback failed:", error);
          });
        }
        throw err;
      }

      await ensureStoreIngredientsActive(prisma, {
        storeIds: targetStoreIds,
        ingredientIds: targetIngredientIds,
      });
      await syncIngredientCategoryUsesForCategory(prisma, {
        partnerId: existing.partnerId,
        categoryId: nextCategoryId,
      });
      if (existing.categoryId && existing.categoryId !== nextCategoryId) {
        await syncIngredientCategoryUsesForCategory(prisma, {
          partnerId: existing.partnerId,
          categoryId: existing.categoryId,
        });
      }

      res.json({ ok: true, id });
    } catch (err) {
      console.error("PUT /pizzas error:", err);
      sendError(res, err);
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await prisma.menuPizza.findUnique({
        where: { id },
        select: { imagePublicId: true },
      });

      if (existing?.imagePublicId) {
        assertCloudinaryConfigured();
        await cloudinary.uploader.destroy(existing.imagePublicId);
      }

      await prisma.menuPizza.delete({ where: { id } });
      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /pizzas error:", err);
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
