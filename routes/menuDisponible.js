import express from "express";

const computeProductStatus = (ingredientsAll) => {
  const ingredients = Array.isArray(ingredientsAll) ? ingredientsAll : [];

  const available = ingredients.every((rel) => {
    const ingredient = rel?.ingredient;
    const storeStock = ingredient?.storeStocks?.[0];

    return (
      ingredient?.status === "ACTIVE" &&
      storeStock?.active === true &&
      Number(storeStock?.stock ?? 0) > 0
    );
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

      const enabledPartnerCategories = await prisma.partnerCategory.findMany({
        where: {
          partnerId: store.partnerId,
          enabled: true,
        },
        select: { categoryId: true },
      });

      const enabledCategoryIds = enabledPartnerCategories.map(
        (row) => row.categoryId
      );

      const rows = await prisma.storePizzaStock.findMany({
        where: {
          storeId,
          active: true,
          pizza: {
            status: "ACTIVE",
            type: "SELLABLE",
            ...(enabledCategoryIds.length
              ? { categoryId: { in: enabledCategoryIds } }
              : { categoryId: null }),
          },
        },
        select: {
          pizzaId: true,
          stock: true,
          active: true,
          pizza: {
            select: {
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
          },
        },
        orderBy: { pizzaId: "asc" },
      });

      const menu = rows
        .map((row) => {
          if (!row?.pizza) return null;

          const ingredientsAll = Array.isArray(row.pizza.ingredients)
            ? row.pizza.ingredients
            : [];

          const recipeStatus = computeProductStatus(ingredientsAll);
          if (!recipeStatus.available) return null;

          const hasStock = row.stock == null || Number(row.stock) > 0;
          if (!hasStock) return null;

          const visibleIngredients = ingredientsAll.filter((rel) => {
            const ing = rel.ingredient;
            const storeStock = ing?.storeStocks?.[0];
            return ing?.status === "ACTIVE" && storeStock?.active === true;
          });

          return {
            pizzaId: row.pizzaId,
            stock: row.stock ?? null,
            name: row.pizza.name,
            categoryId: row.pizza.categoryId ?? null,
            category: row.pizza.categoryRef?.name ?? row.pizza.category ?? null,
            selectSize: row.pizza.selectSize ?? [],
            priceBySize: row.pizza.priceBySize ?? {},
            image: row.pizza.image ?? null,
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
