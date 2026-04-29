import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

const zeroStockForNewPizza = async (prisma, pizzaId, partnerId) => {
  const stores = await prisma.store.findMany({
    where: { partnerId },
    select: { id: true },
  });

  if (!stores.length) return;

  await prisma.storePizzaStock.createMany({
    data: stores.map((store) => ({
      storeId: store.id,
      pizzaId,
      stock: 0,
      active: true,
    })),
    skipDuplicates: true,
  });
};

const assertIngredientsAvailableForStore = async (
  prisma,
  storeId,
  partnerId,
  ingredients
) => {
  if (!storeId) return;

  const parsedStoreId = Number(storeId);

  if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
    const error = new Error("Invalid storeId");
    error.status = 400;
    throw error;
  }

  const store = await prisma.store.findFirst({
    where: {
      id: parsedStoreId,
      partnerId,
    },
    select: { id: true },
  });

  if (!store) {
    const error = new Error("Store not found for partner");
    error.status = 404;
    throw error;
  }

  const ingredientIds = [...new Set(
    (Array.isArray(ingredients) ? ingredients : [])
      .map((item) => Number(item?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  if (!ingredientIds.length) return;

  const storeIngredients = await prisma.storeIngredientStock.findMany({
    where: {
      storeId: parsedStoreId,
      ingredientId: { in: ingredientIds },
      active: true,
    },
    select: { ingredientId: true },
  });

  const availableIds = new Set(storeIngredients.map((item) => item.ingredientId));
  const missingIds = ingredientIds.filter((id) => !availableIds.has(id));

  if (missingIds.length) {
    const error = new Error(
      `Some ingredients are not active in store inventory: ${missingIds.join(", ")}`
    );
    error.status = 400;
    throw error;
  }
};

const mapPizza = (pizza) => ({
  ...pizza,
  categoryId: pizza.categoryId ?? null,
  categoryName: pizza.category ?? null,
  category: pizza.category ?? null,
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

  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    { folder: `volta/partners/${partnerId}/pizzas` }
  );

  return {
    image: result.secure_url,
    imagePublicId: result.public_id,
  };
};

export default function pizzasRoutes(prisma) {
  router.get("/", async (req, res) => {
    try {
      const partnerId = req.query.partnerId
        ? Number(req.query.partnerId)
        : null;

      const pizzas = await prisma.menuPizza.findMany({
        where: partnerId ? { partnerId } : undefined,
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
      const {
        name,
        partnerId,
        storeId,
        categoryId,
        sizes,
        priceBySize,
        cookingMethod,
        ingredients,
        launchAt,
      } = req.body;

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

      await assertIngredientsAvailableForStore(
        prisma,
        storeId,
        parsedPartnerId,
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
        cookingMethod: cookingMethod || null,
        launchAt: parseLaunchAt(launchAt),
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

      await zeroStockForNewPizza(prisma, pizza.id, parsedPartnerId);

      res.json(mapPizza(createdPizza || pizza));
    } catch (err) {
      console.error("POST /pizzas error:", err);
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  router.put("/:id", upload.single("image"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });

      const existing = await prisma.menuPizza.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({ error: "Pizza not found" });
      }

      const parsedSizes = parseMaybeJson(req.body.sizes, []);
      const parsedPrices = parseMaybeJson(req.body.priceBySize, {});
      const parsedIngredients = parseMaybeJson(req.body.ingredients, []);

      await assertIngredientsAvailableForStore(
        prisma,
        req.body.storeId,
        existing.partnerId,
        parsedIngredients
      );

      let nextCategoryId = existing.categoryId ?? null;
      let nextCategoryName = existing.category ?? null;
      let nextImage = existing.image ?? null;
      let nextImagePublicId = existing.imagePublicId ?? null;

      if (req.body.categoryId != null && req.body.categoryId !== "") {
        const category = await getCategoryOrThrow(prisma, req.body.categoryId);
        nextCategoryId = category.id;
        nextCategoryName = category.name;
      }

      if (req.file) {
        if (existing.imagePublicId) {
          await cloudinary.uploader.destroy(existing.imagePublicId);
        }

        const uploadedImage = await uploadPizzaImage(
          req.file,
          existing.partnerId
        );
        nextImage = uploadedImage.image;
        nextImagePublicId = uploadedImage.imagePublicId;
      }

      const updateData = {
        name: req.body.name?.trim() ?? existing.name,
        categoryId: nextCategoryId,
        category: nextCategoryName,
        selectSize: parsedSizes,
        priceBySize: parsedPrices,
        cookingMethod: req.body.cookingMethod ?? null,
        launchAt: parseLaunchAt(req.body.launchAt),
        image: nextImage,
        imagePublicId: nextImagePublicId,
      };

      try {
        await prisma.menuPizza.update({
          where: { id },
          data: updateData,
        });
      } catch (err) {
        if (canUseCategoryId(err)) {
          throw err;
        }

        const { categoryId: _ignoredCategoryId, ...fallbackData } = updateData;

        await prisma.menuPizza.update({
          where: { id },
          data: fallbackData,
        });
      }

      await prisma.menuPizzaIngredient.deleteMany({
        where: { menuPizzaId: id },
      });

      if (parsedIngredients.length) {
        await prisma.menuPizzaIngredient.createMany({
          data: parsedIngredients
            .filter((x) => Number(x?.id))
            .map((x) => ({
              menuPizzaId: id,
              ingredientId: Number(x.id),
              qtyBySize: x.qtyBySize || {},
            })),
        });
      }

      res.json({ ok: true, id });
    } catch (err) {
      console.error("PUT /pizzas error:", err);
      res.status(err.status || 400).json({ error: err.message });
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
