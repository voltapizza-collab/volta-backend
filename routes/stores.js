import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { partnerId } = req.query;

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId required" });
    }

    const stores = await prisma.store.findMany({
      where: {
        partnerId: Number(partnerId),
      },
    });

    res.json(stores);
  } catch (e) {
    console.error("GET STORES ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:partnerSlug/:storeSlug/menu", async (req, res) => {
  try {
    const { partnerSlug, storeSlug } = req.params;

    const partner = await prisma.partner.findUnique({
      where: { slug: partnerSlug },
    });

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    const store = await prisma.store.findFirst({
      where: {
        slug: storeSlug,
        partnerId: partner.id,
      },
    });

    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    const pizzas = await prisma.menuPizza.findMany({
      where: {
        partnerId: store.partnerId,
        status: "ACTIVE",
        type: "SELLABLE",
      },
      select: {
        id: true,
        name: true,
        category: true,
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
                  where: { storeId: store.id },
                  select: { active: true },
                },
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const availablePizzas = pizzas.filter((pizza) => {
      const recipe = Array.isArray(pizza.ingredients) ? pizza.ingredients : [];

      return recipe.every((rel) => {
        const ingredient = rel.ingredient;
        const storeStock = ingredient?.storeStocks?.[0];
        return ingredient?.status === "ACTIVE" && storeStock?.active === true;
      });
    });

    const menu = availablePizzas.map((pizza) => ({
      pizzaId: pizza.id,
      name: pizza.name,
      categoryId: null,
      category: pizza.category ?? null,
      selectSize: pizza.selectSize ?? [],
      priceBySize: pizza.priceBySize ?? {},
      image: pizza.image ?? null,
      ingredients: (pizza.ingredients || []).map((rel) => ({
        id: rel.ingredient.id,
        name: rel.ingredient.name,
        qtyBySize: rel.qtyBySize ?? {},
      })),
      extras: [],
      available: true,
    }));

    res.json({
      store: {
        id: store.id,
        storeName: store.storeName,
        slug: store.slug,
        city: store.city,
      },
      menu,
    });
  } catch (e) {
    console.error("GET MENU ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:partnerSlug/:storeSlug", async (req, res) => {
  try {
    const { partnerSlug, storeSlug } = req.params;

    const partner = await prisma.partner.findUnique({
      where: { slug: partnerSlug },
    });

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    const store = await prisma.store.findFirst({
      where: {
        slug: storeSlug,
        partnerId: partner.id,
      },
      include: {
        partner: true,
      },
    });

    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    res.json(store);
  } catch (e) {
    console.error("GET STORE ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { storeName, slug, partnerId, address } = req.body;

    const store = await prisma.store.create({
      data: {
        storeName,
        slug,
        partnerId,
        address: address || "",
      },
    });

    res.json(store);
  } catch (e) {
    console.error("CREATE STORE ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
