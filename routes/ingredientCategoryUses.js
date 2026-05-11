import express from "express";

const normalizePositiveId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const normalizePriceBySize = (value, fallbackPrice = 0) => {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};

  const entries = Object.entries(source).reduce((acc, [size, price]) => {
    const normalizedSize = String(size || "").trim();
    if (!normalizedSize) return acc;

    const normalizedPrice = Number(price);
    acc[normalizedSize] = Number.isFinite(normalizedPrice)
      ? normalizedPrice
      : 0;
    return acc;
  }, {});

  if (Object.keys(entries).length) return entries;

  const normalizedFallback = Number(fallbackPrice);
  return Number.isFinite(normalizedFallback) && normalizedFallback > 0
    ? { S: normalizedFallback, M: normalizedFallback, L: normalizedFallback }
    : {};
};

const getPrimaryPrice = (priceBySize, fallbackPrice = 0) => {
  const prices =
    priceBySize && typeof priceBySize === "object"
      ? Object.values(priceBySize)
      : [];
  const firstPrice = prices.find((price) => Number.isFinite(Number(price)));

  if (firstPrice != null) return Number(firstPrice);

  const normalizedFallback = Number(fallbackPrice);
  return Number.isFinite(normalizedFallback) ? normalizedFallback : 0;
};

const resolvePartnerId = async (prisma, partnerIdValue, storeIdValue) => {
  const directPartnerId = normalizePositiveId(partnerIdValue);
  if (directPartnerId) return directPartnerId;

  const storeId = normalizePositiveId(storeIdValue);
  if (!storeId) return null;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { partnerId: true },
  });

  return normalizePositiveId(store?.partnerId);
};

const groupUses = (rows) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = row.ingredientId;

    if (!grouped.has(key)) {
      grouped.set(key, {
        ingredientId: row.ingredientId,
        ingredientName: row.ingredient?.name || `Ingrediente ${row.ingredientId}`,
        ingredientCategory: row.ingredient?.category || "OTROS",
        costPrice: row.ingredient?.costPrice ?? null,
        categories: [],
      });
    }

    grouped.get(key).categories.push({
      id: row.categoryId,
      name: row.category?.name || `Categoria ${row.categoryId}`,
      price: row.price ?? 0,
      priceBySize: normalizePriceBySize(row.priceBySize, row.price),
      costPrice: row.ingredient?.costPrice ?? row.costPrice ?? null,
      costBySize:
        row.costBySize && typeof row.costBySize === "object" ? row.costBySize : {},
      active: row.active !== false,
    });
  });

  return [...grouped.values()].sort((a, b) =>
    a.ingredientName.localeCompare(b.ingredientName, "es", {
      sensitivity: "base",
    })
  );
};

export default function ingredientCategoryUsesRoutes(prisma) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const partnerId = await resolvePartnerId(
        prisma,
        req.query.partnerId,
        req.query.storeId
      );
      const storeId = normalizePositiveId(req.query.storeId);
      const categoryId = normalizePositiveId(req.query.categoryId);

      if (!partnerId || !categoryId) {
        return res
          .status(400)
          .json({ error: "partnerId or storeId, and categoryId required" });
      }

      const rows = await prisma.ingredientCategoryUse.findMany({
        where: {
          partnerId,
          categoryId,
          active: true,
          ingredient: {
            menuPizzas: {
              some: {
                menuPizza: {
                  partnerId,
                  categoryId,
                  status: "ACTIVE",
                  type: "SELLABLE",
                },
              },
            },
          },
        },
        include: {
          ingredient: {
            select: {
              id: true,
              name: true,
              category: true,
              allergens: true,
              costPrice: true,
              status: true,
              ...(storeId
                ? {
                    storeStocks: {
                    where: { storeId },
                    select: { active: true },
                    },
                  }
                : {}),
            },
          },
        },
        orderBy: {
          ingredient: { name: "asc" },
        },
      });

      const availableRows = rows.filter((row) => {
        const ingredient = row.ingredient;
        if (ingredient?.status !== "ACTIVE") return false;
        if (!storeId) return true;

        return ingredient?.storeStocks?.[0]?.active === true;
      });

      res.json(
        availableRows.map((row) => ({
          id: row.ingredientId,
          ingredientId: row.ingredientId,
          name: row.ingredient?.name || `Ingrediente ${row.ingredientId}`,
          category: row.ingredient?.category || "OTROS",
          allergens: Array.isArray(row.ingredient?.allergens)
            ? row.ingredient.allergens
            : [],
          price: Number(row.price || 0),
          priceBySize: normalizePriceBySize(row.priceBySize, row.price),
          costPrice: row.ingredient?.costPrice ?? row.costPrice ?? null,
          costBySize:
            row.costBySize && typeof row.costBySize === "object"
              ? row.costBySize
              : {},
        }))
      );
    } catch (err) {
      console.error("ingredientCategoryUses GET error:", err);
      res.status(500).json({ error: "Error fetching ingredient uses" });
    }
  });

  router.get("/all", async (req, res) => {
    try {
      const partnerId = await resolvePartnerId(
        prisma,
        req.query.partnerId,
        req.query.storeId
      );

      if (!partnerId) {
        return res.status(400).json({ error: "partnerId or storeId required" });
      }

      const rows = await prisma.ingredientCategoryUse.findMany({
        where: { partnerId },
        include: {
          ingredient: {
            select: {
              id: true,
              name: true,
              category: true,
              costPrice: true,
            },
          },
          category: {
            select: { id: true, name: true },
          },
        },
        orderBy: [
          { ingredient: { name: "asc" } },
          { category: { name: "asc" } },
        ],
      });

      res.json(groupUses(rows));
    } catch (err) {
      console.error("ingredientCategoryUses all error:", err);
      res.status(500).json({ error: "Error fetching ingredient uses" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const partnerId = await resolvePartnerId(
        prisma,
        req.body?.partnerId,
        req.body?.storeId
      );
      const ingredientId = normalizePositiveId(req.body?.ingredientId);
      const links = Array.isArray(req.body?.links) ? req.body.links : [];

      if (!partnerId || !ingredientId) {
        return res
          .status(400)
          .json({ error: "partnerId or storeId, and ingredientId required" });
      }

      const ingredient = await prisma.ingredient.findUnique({
        where: { id: ingredientId },
        select: { id: true },
      });

      if (!ingredient) {
        return res.status(404).json({ error: "Ingredient not found" });
      }

      const categoryIds = [
        ...new Set(
          links
            .map((link) => normalizePositiveId(link?.categoryId))
            .filter(Boolean)
        ),
      ];

      if (!categoryIds.length) {
        await prisma.ingredientCategoryUse.deleteMany({
          where: { partnerId, ingredientId },
        });

        return res.json({ ok: true, ingredientId, links: [] });
      }

      const categories = await prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true },
      });

      if (categories.length !== categoryIds.length) {
        return res
          .status(404)
          .json({ error: "One or more categories were not found" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.ingredientCategoryUse.deleteMany({
          where: { partnerId, ingredientId },
        });

        await tx.ingredientCategoryUse.createMany({
          data: categoryIds.map((categoryId) => {
            const link = links.find(
              (item) => normalizePositiveId(item?.categoryId) === categoryId
            );
            const priceBySize = normalizePriceBySize(
              link?.priceBySize,
              link?.price
            );
            const costBySize =
              link?.costBySize &&
              typeof link.costBySize === "object" &&
              !Array.isArray(link.costBySize)
                ? link.costBySize
                : {};
            const costPrice = Number(link?.costPrice);

            return {
              partnerId,
              ingredientId,
              categoryId,
              price: getPrimaryPrice(priceBySize, link?.price),
              priceBySize,
              costPrice: Number.isFinite(costPrice) ? costPrice : null,
              costBySize,
              active: link?.active !== false,
            };
          }),
        });
      });

      res.json({ ok: true, ingredientId });
    } catch (err) {
      console.error("ingredientCategoryUses POST error:", err);
      res.status(500).json({ error: "Error saving ingredient uses" });
    }
  });

  router.delete("/:ingredientId", async (req, res) => {
    try {
      const partnerId = await resolvePartnerId(
        prisma,
        req.query.partnerId,
        req.query.storeId
      );
      const ingredientId = normalizePositiveId(req.params.ingredientId);

      if (!partnerId || !ingredientId) {
        return res
          .status(400)
          .json({ error: "partnerId or storeId, and ingredientId required" });
      }

      await prisma.ingredientCategoryUse.deleteMany({
        where: { partnerId, ingredientId },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("ingredientCategoryUses DELETE error:", err);
      res.status(500).json({ error: "Error deleting ingredient uses" });
    }
  });

  return router;
}
