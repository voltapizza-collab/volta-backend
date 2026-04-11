import express from "express";

const normalizePartnerId = (value) => {
  const partnerId = Number(value);
  return Number.isInteger(partnerId) && partnerId > 0 ? partnerId : null;
};

const normalizeStoreId = (value) => {
  const storeId = Number(value);
  return Number.isInteger(storeId) && storeId > 0 ? storeId : null;
};

const resolvePartnerId = async (prisma, partnerIdValue, storeIdValue) => {
  const directPartnerId = normalizePartnerId(partnerIdValue);
  if (directPartnerId) return directPartnerId;

  const storeId = normalizeStoreId(storeIdValue);
  if (!storeId) return null;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { partnerId: true },
  });

  return normalizePartnerId(store?.partnerId);
};

const groupExtras = (rows) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = row.ingredientId;

    if (!grouped.has(key)) {
      grouped.set(key, {
        ingredientId: row.ingredientId,
        ingredientName: row.ingredient?.name || `Ingrediente ${row.ingredientId}`,
        categories: [],
      });
    }

    grouped.get(key).categories.push({
      id: row.categoryId,
      name: row.category?.name || `Categoria ${row.categoryId}`,
      price: row.price ?? 0,
      status: row.status ?? "ACTIVE",
    });
  });

  return [...grouped.values()].sort((a, b) =>
    a.ingredientName.localeCompare(b.ingredientName, "es", {
      sensitivity: "base",
    })
  );
};

export default function ingredientExtrasRoutes(prisma) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const partnerId = await resolvePartnerId(
        prisma,
        req.query.partnerId,
        req.query.storeId
      );
      const categoryId = Number(req.query.categoryId);

      if (!partnerId || !Number.isInteger(categoryId) || categoryId <= 0) {
        return res
          .status(400)
          .json({ error: "partnerId or storeId, and categoryId required" });
      }

      const rows = await prisma.ingredientExtra.findMany({
        where: {
          partnerId,
          status: "ACTIVE",
          categoryId,
        },
        include: {
          ingredient: {
            select: { id: true, name: true },
          },
        },
        orderBy: {
          ingredient: { name: "asc" },
        },
      });

      res.json(
        rows.map((row) => ({
          ingredientId: row.ingredientId,
          name: row.ingredient?.name || `Ingrediente ${row.ingredientId}`,
          price: Number(row.price || 0),
        }))
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error fetching extras by category" });
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

      const extras = await prisma.ingredientExtra.findMany({
        where: {
          partnerId,
          status: "ACTIVE",
        },
        include: {
          ingredient: {
            select: { id: true, name: true },
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

      res.json(groupExtras(extras));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error fetching extras" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const partnerId = await resolvePartnerId(
        prisma,
        req.body?.partnerId,
        req.body?.storeId
      );
      const ingredientId = Number(req.body?.ingredientId);
      const links = Array.isArray(req.body?.links) ? req.body.links : [];

      if (!partnerId || !Number.isInteger(ingredientId) || ingredientId <= 0) {
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

      const categoryIds = [...new Set(
        links
          .map((link) => Number(link?.categoryId))
          .filter((id) => Number.isInteger(id) && id > 0)
      )];

      if (!categoryIds.length) {
        await prisma.ingredientExtra.deleteMany({
          where: { partnerId, ingredientId },
        });

        return res.json({ ok: true, ingredientId, links: [] });
      }

      const categories = await prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true },
      });

      if (categories.length !== categoryIds.length) {
        return res.status(404).json({ error: "One or more categories were not found" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.ingredientExtra.deleteMany({
          where: { partnerId, ingredientId },
        });

        await tx.ingredientExtra.createMany({
          data: categoryIds.map((categoryId) => {
            const link = links.find((item) => Number(item?.categoryId) === categoryId);
            return {
              partnerId,
              ingredientId,
              categoryId,
              price: Number(link?.price || 0),
              status: "ACTIVE",
            };
          }),
        });
      });

      res.json({ ok: true, ingredientId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error saving extras" });
    }
  });

  router.delete("/:ingredientId", async (req, res) => {
    try {
      const partnerId = await resolvePartnerId(
        prisma,
        req.query.partnerId,
        req.query.storeId
      );
      const ingredientId = Number(req.params.ingredientId);

      if (!partnerId || !Number.isInteger(ingredientId) || ingredientId <= 0) {
        return res
          .status(400)
          .json({ error: "partnerId or storeId, and ingredientId required" });
      }

      await prisma.ingredientExtra.deleteMany({
        where: { partnerId, ingredientId },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error deleting extra" });
    }
  });

  return router;
}
