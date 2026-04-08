import express from "express";

const getPartnerOrThrow = async (prisma, partnerId) => {
  const parsedPartnerId = Number(partnerId);

  if (!Number.isInteger(parsedPartnerId) || parsedPartnerId <= 0) {
    const error = new Error("Invalid partnerId");
    error.status = 400;
    throw error;
  }

  const partner = await prisma.partner.findUnique({
    where: { id: parsedPartnerId },
    select: { id: true },
  });

  if (!partner) {
    const error = new Error("Partner not found");
    error.status = 404;
    throw error;
  }

  return parsedPartnerId;
};

const loadGlobalCategoryFallback = async (prisma) => {
  const categories = await prisma.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });

  return categories.map((category, index) => ({
    id: category.id,
    partnerCategoryId: null,
    name: category.name,
    enabled: true,
    position: category.position ?? index,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }));
};

const persistGlobalCategoryOrder = async (prisma, orderedIds) => {
  await prisma.$transaction(
    orderedIds.map((categoryId, index) =>
      prisma.category.update({
        where: { id: Number(categoryId) },
        data: { position: index },
      })
    )
  );
};

const syncPartnerCategories = async (prisma, partnerId) => {
  const partnerCategoryModel = prisma.partnerCategory;

  if (!partnerCategoryModel) {
    return loadGlobalCategoryFallback(prisma);
  }

  let categories;
  let links;

  try {
    [categories, links] = await Promise.all([
      prisma.category.findMany({
        orderBy: { name: "asc" },
      }),
      partnerCategoryModel.findMany({
        where: { partnerId },
        orderBy: { position: "asc" },
      }),
    ]);
  } catch (err) {
    console.error("partnerCategories fallback:", err.message);
    return loadGlobalCategoryFallback(prisma);
  }

  const existingByCategoryId = new Map(
    links.map((link) => [link.categoryId, link])
  );

  const missingCategories = categories.filter(
    (category) => !existingByCategoryId.has(category.id)
  );

  if (missingCategories.length) {
    const startPosition = links.length;
    try {
      await prisma.partnerCategory.createMany({
        data: missingCategories.map((category, index) => ({
          partnerId,
          categoryId: category.id,
          enabled: true,
          position: startPosition + index,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      console.error("partnerCategories create fallback:", err.message);
      return loadGlobalCategoryFallback(prisma);
    }
  }

  let finalLinks;
  try {
    finalLinks = await partnerCategoryModel.findMany({
      where: { partnerId },
      include: {
        category: true,
      },
      orderBy: [{ position: "asc" }, { category: { name: "asc" } }],
    });
  } catch (err) {
    console.error("partnerCategories final fallback:", err.message);
    return loadGlobalCategoryFallback(prisma);
  }

  return finalLinks.map((link) => ({
    id: link.category.id,
    partnerCategoryId: link.id,
    name: link.category.name,
    enabled: link.enabled,
    position: link.position,
    createdAt: link.category.createdAt,
    updatedAt: link.category.updatedAt,
  }));
};

const withPartnerCategoryFallback = async (prisma, task) => {
  try {
    if (!prisma.partnerCategory) {
      throw new Error("PartnerCategory not available");
    }

    return await task(prisma.partnerCategory);
  } catch (err) {
    console.error("partnerCategories runtime fallback:", err.message);
    return null;
  }
};

export default function partnerCategoriesRoutes(prisma) {
  const router = express.Router();

  router.get("/partners/:partnerId/categories", async (req, res) => {
    try {
      const partnerId = await getPartnerOrThrow(prisma, req.params.partnerId);
      const rows = await syncPartnerCategories(prisma, partnerId);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.patch("/partners/:partnerId/categories/order", async (req, res) => {
    try {
      const partnerId = await getPartnerOrThrow(prisma, req.params.partnerId);
      const { orderedIds } = req.body;

      if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        return res.status(400).json({ error: "orderedIds required" });
      }

      if (!prisma.partnerCategory) {
        await persistGlobalCategoryOrder(prisma, orderedIds);
        return res.json({ ok: true, fallback: true, scope: "global-category" });
      }

      await syncPartnerCategories(prisma, partnerId);

      const reordered = await withPartnerCategoryFallback(
        prisma,
        async (partnerCategoryModel) =>
          prisma.$transaction(
            orderedIds.map((categoryId, index) =>
              partnerCategoryModel.update({
              where: {
                partnerId_categoryId: {
                  partnerId,
                  categoryId: Number(categoryId),
                },
              },
              data: { position: index },
              })
            )
          )
      );

      if (!reordered) {
        await persistGlobalCategoryOrder(prisma, orderedIds);
        return res.json({ ok: true, fallback: true, scope: "global-category" });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.patch("/partners/:partnerId/categories/:categoryId", async (req, res) => {
    try {
      const partnerId = await getPartnerOrThrow(prisma, req.params.partnerId);
      const categoryId = Number(req.params.categoryId);
      const { enabled } = req.body;

      if (!prisma.partnerCategory) {
        return res.json({
          id: categoryId,
          partnerCategoryId: null,
          enabled: Boolean(enabled),
          fallback: true,
        });
      }

      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).json({ error: "Invalid categoryId" });
      }

      const category = await prisma.category.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });

      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }

      const rows = await syncPartnerCategories(prisma, partnerId);
      const existing = rows.find((row) => row.id === categoryId);

      const updated = await withPartnerCategoryFallback(
        prisma,
        (partnerCategoryModel) =>
          partnerCategoryModel.upsert({
          where: {
            partnerId_categoryId: {
              partnerId,
              categoryId,
            },
          },
          update: {
            enabled: Boolean(enabled),
          },
          create: {
            partnerId,
            categoryId,
            enabled: Boolean(enabled),
            position: existing?.position ?? rows.length,
          },
          include: {
            category: true,
          },
          })
      );

      if (!updated) {
        return res.json({
          id: categoryId,
          partnerCategoryId: null,
          enabled: Boolean(enabled),
          fallback: true,
        });
      }

      res.json({
        id: updated.category.id,
        partnerCategoryId: updated.id,
        name: updated.category.name,
        enabled: updated.enabled,
        position: updated.position,
      });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  return router;
}
