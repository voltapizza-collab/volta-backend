import express from "express";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export default function stockRoutes(prisma) {
  const router = express.Router();

  router.get("/:storeId", async (req, res) => {
    const storeId = parsePositiveInt(req.params.storeId);
    if (!storeId) {
      return res.status(400).json({ error: "Invalid storeId" });
    }

    try {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true, partnerId: true },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      const pizzas = await prisma.menuPizza.findMany({
        where: {
          partnerId: store.partnerId,
          type: "SELLABLE",
        },
        include: {
          ingredients: {
            include: {
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  storeStocks: {
                    where: { storeId },
                    select: { active: true },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });

      const stockRows = await prisma.storePizzaStock.findMany({
        where: { storeId },
      });

      const stockMap = new Map(
        stockRows.map((row) => [row.pizzaId, { stock: row.stock, active: row.active }])
      );

      const result = pizzas.map((pizza) => {
        const row = stockMap.get(pizza.id);

        return {
          pizzaId: pizza.id,
          pizza: {
            id: pizza.id,
            name: pizza.name,
            category: pizza.category,
            ingredients: (pizza.ingredients || []).map((rel) => ({
              id: rel.ingredient?.id,
              name: rel.ingredient?.name,
              status:
                rel.ingredient?.status === "ACTIVE" &&
                rel.ingredient?.storeStocks?.[0]?.active === true
                  ? "ACTIVE"
                  : "INACTIVE",
            })),
          },
          stock: row?.stock ?? 0,
          active: row?.active ?? true,
        };
      });

      return res.json(result);
    } catch (error) {
      console.error("[GET /stock/:storeId]", error);
      return res.status(500).json({ error: "Error loading stock" });
    }
  });

  router.patch("/:storeId/:pizzaId", async (req, res) => {
    const storeId = parsePositiveInt(req.params.storeId);
    const pizzaId = parsePositiveInt(req.params.pizzaId);
    const { set, delta } = req.body;

    if (!storeId || !pizzaId) {
      return res.status(400).json({ error: "Invalid ids" });
    }

    if (set === undefined && delta === undefined) {
      return res.status(400).json({ error: "set o delta requerido" });
    }

    try {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { partnerId: true },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      const pizza = await prisma.menuPizza.findFirst({
        where: {
          id: pizzaId,
          partnerId: store.partnerId,
        },
        select: { id: true },
      });

      if (!pizza) {
        return res.status(404).json({ error: "Pizza not found for store partner" });
      }

      const updated = await prisma.storePizzaStock.upsert({
        where: {
          storeId_pizzaId: { storeId, pizzaId },
        },
        update: {
          stock:
            set !== undefined ? Number(set) : { increment: Number(delta) },
        },
        create: {
          storeId,
          pizzaId,
          stock: Number(set ?? delta ?? 0),
          active: true,
        },
      });

      return res.json(updated);
    } catch (error) {
      console.error("[PATCH /stock/:storeId/:pizzaId]", error);
      return res.status(500).json({ error: "Failed to update stock" });
    }
  });

  router.patch("/:storeId/:pizzaId/active", async (req, res) => {
    const storeId = parsePositiveInt(req.params.storeId);
    const pizzaId = parsePositiveInt(req.params.pizzaId);
    const { active } = req.body;

    if (!storeId || !pizzaId) {
      return res.status(400).json({ error: "Invalid ids" });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "active boolean requerido" });
    }

    try {
      const updated = await prisma.storePizzaStock.upsert({
        where: { storeId_pizzaId: { storeId, pizzaId } },
        update: { active },
        create: {
          storeId,
          pizzaId,
          stock: 0,
          active,
        },
      });

      return res.json(updated);
    } catch (error) {
      console.error("[PATCH /stock/:storeId/:pizzaId/active]", error);
      return res.status(500).json({ error: "Failed to toggle active" });
    }
  });

  return router;
}
