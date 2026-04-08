import express from "express";

export default function basesPizzasRoutes(prisma) {
  const r = express.Router();

  r.get("/", async (req, res) => {
    try {
      const partnerId = req.query.partnerId ? Number(req.query.partnerId) : null;

      const enabledCategoryIds = partnerId
        ? (
            await prisma.partnerCategory.findMany({
              where: {
                partnerId,
                enabled: true,
              },
              select: { categoryId: true },
            })
          ).map((row) => row.categoryId)
        : [];

      const rows = await prisma.menuPizza.findMany({
        where: {
          ...(partnerId ? { partnerId } : {}),
          ...(partnerId
            ? enabledCategoryIds.length
              ? { categoryId: { in: enabledCategoryIds } }
              : { categoryId: null }
            : {}),
          status: "ACTIVE",
          name: {
            startsWith: "BASE",
          },
        },
        select: {
          id: true,
          name: true,
          category: true,
          categoryId: true,
          categoryRef: {
            select: {
              id: true,
              name: true,
            },
          },
          selectSize: true,
          priceBySize: true,
          image: true,
        },
        orderBy: { id: "asc" },
      });

      res.json(
        rows.map((row) => ({
          pizzaId: row.id,
          name: row.name,
          categoryId: row.categoryId ?? null,
          category: row.categoryRef?.name ?? row.category ?? null,
          selectSize: row.selectSize ?? [],
          priceBySize: row.priceBySize ?? {},
          image: row.image ?? null,
        }))
      );
    } catch (err) {
      console.error("basesPizzas error:", err);
      res.status(500).json([]);
    }
  });

  return r;
}
