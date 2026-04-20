import express from "express";

const computeProductStatus = (pizzaStock, ingredientsAll) => {
  const ingredients = Array.isArray(ingredientsAll) ? ingredientsAll : [];
  const storePizzaState = pizzaStock?.[0];

  if (!storePizzaState || storePizzaState.active !== true) {
    return { available: false };
  }

  const available = ingredients.every((rel) => {
    const ingredient = rel?.ingredient;
    const storeStock = ingredient?.storeStocks?.[0];

    return ingredient?.status === "ACTIVE" && storeStock?.active === true;
  });

  return { available };
};

export default function menuDisponibleRoutes(prisma) {
  const r = express.Router();

  r.get("/:storeId", async (req, res) => {
    try {
      const storeId = Number(req.params.storeId);
      if (!storeId) return res.json([]);

      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { partnerId: true },
      });

      if (!store) return res.json([]);

      let enabledPartnerCategories = [];

      if (prisma.partnerCategory) {
        try {
          enabledPartnerCategories = await prisma.partnerCategory.findMany({
            where: {
              partnerId: store.partnerId,
              enabled: true,
            },
            select: { categoryId: true },
          });
        } catch (partnerCategoryError) {
          console.error(
            "menuDisponible partnerCategory fallback:",
            partnerCategoryError?.message || partnerCategoryError
          );
          enabledPartnerCategories = [];
        }
      }

      const enabledCategoryIds = enabledPartnerCategories.map(
        (row) => row.categoryId
      );

      const rows = await prisma.menuPizza.findMany({
        where: {
          partnerId: store.partnerId,
          status: "ACTIVE",
          type: "SELLABLE",
          ...(enabledCategoryIds.length
            ? { categoryId: { in: enabledCategoryIds } }
            : {}),
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
        stocks: {
          where: { storeId },
          select: {
            active: true,
            stock: true,
          },
        },
        ingredients: {
          select: {
            qtyBySize: true,
            ingredient: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  storeStocks: {
                    where: { storeId },
                    select: { active: true, stock: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { id: "asc" },
      });

      const menu = rows
        .map((row) => {
          const ingredientsAll = Array.isArray(row.ingredients)
            ? row.ingredients
            : [];
          const pizzaStock = Array.isArray(row.stocks) ? row.stocks : [];

          const recipeStatus = computeProductStatus(pizzaStock, ingredientsAll);
          if (!recipeStatus.available) return null;

          const visibleIngredients = ingredientsAll.filter((rel) => {
            const ing = rel.ingredient;
            const storeStock = ing?.storeStocks?.[0];
            return ing?.status === "ACTIVE" && storeStock?.active === true;
          });

          return {
            pizzaId: row.id,
            name: row.name,
            categoryId: row.categoryId ?? null,
            category: row.categoryRef?.name ?? row.category ?? null,
            selectSize: row.selectSize ?? [],
            priceBySize: row.priceBySize ?? {},
            image: row.image ?? null,
            stock: pizzaStock?.[0]?.stock ?? null,
            ingredients: visibleIngredients.map((rel) => ({
              id: rel.ingredient.id,
              name: rel.ingredient.name,
              qtyBySize: rel.qtyBySize,
            })),
            available: true,
          };
        })
        .filter(Boolean);

      res.json(menu);
    } catch (err) {
      console.error("menuDisponible error:", err);
      res.json([]);
    }
  });

  return r;
}
