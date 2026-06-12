import express from "express";
import { sendIngredientDisabledTrackingSms } from "../services/trackingNotifications.js";
import { ensureIngredientMediaColumns } from "../services/ingredientMediaColumns.js";
import prisma from "../services/prisma.js";

const router = express.Router({ mergeParams: true });
const DEMO_PARTNER_SLUG = "volta-demo";
const DEMO_INGREDIENT_NAMES = new Set([
  "mozzarella demo",
  "pepperoni demo",
  "tomate san marzano demo",
  "champinones demo",
]);

const parseId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const normalizeAllergens = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }

  return [];
};

const isDemoIngredient = (ingredient) =>
  DEMO_INGREDIENT_NAMES.has(String(ingredient?.name || "").trim().toLowerCase());

const isDemoStore = async (storeId) => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      partner: { select: { slug: true } },
    },
  });

  if (!store) return null;
  return store.partner?.slug === DEMO_PARTNER_SLUG;
};

const serializeIngredient = (ing, storeStock, extra = {}) => {
  const isPriced = Number(ing.costPrice) > 0;

  return {
    id: ing.id,
    name: ing.name,
    category: ing.category,
    status: ing.status,
    allergens: normalizeAllergens(ing.allergens),
    unit: ing.unit,
    costPrice: ing.costPrice,
    description: ing.description || "",
    image: ing.image || null,
    imagePublicId: ing.imagePublicId || null,
    exists: !!storeStock,
    active: ing.status === "ACTIVE" && isPriced && storeStock?.active === true,
    stock: storeStock ? storeStock.stock : 0,
    ...extra,
  };
};

const getMenuScopedIngredients = async (storeId) => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      partnerId: true,
      partner: { select: { slug: true } },
    },
  });

  if (!store) return null;

  const pizzas = await prisma.menuPizza.findMany({
    where: {
      partnerId: store.partnerId,
      status: "ACTIVE",
      type: "SELLABLE",
      stocks: {
        some: {
          storeId,
          active: true,
        },
      },
    },
    select: {
      id: true,
      name: true,
      category: true,
      ingredients: {
        select: {
          ingredient: {
            select: {
              id: true,
              name: true,
              category: true,
              status: true,
              allergens: true,
              unit: true,
              costPrice: true,
              description: true,
              image: true,
              imagePublicId: true,
              storeStocks: {
                where: { storeId },
                select: {
                  active: true,
                  stock: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const byIngredient = new Map();

  pizzas.forEach((pizza) => {
    (pizza.ingredients || []).forEach((rel) => {
      const ingredient = rel.ingredient;
      if (!ingredient || ingredient.status !== "ACTIVE") return;

      if (!byIngredient.has(ingredient.id)) {
        byIngredient.set(ingredient.id, {
          ingredient,
          products: [],
        });
      }

      byIngredient.get(ingredient.id).products.push({
        id: pizza.id,
        name: pizza.name,
        category: pizza.category,
      });
    });
  });

  const allowDemoIngredients = store.partner?.slug === DEMO_PARTNER_SLUG;

  return [...byIngredient.values()]
    .filter(({ ingredient }) => allowDemoIngredients || !isDemoIngredient(ingredient))
    .map(({ ingredient, products }) => {
      const uniqueProducts = [
        ...new Map(products.map((product) => [product.id, product])).values(),
      ].sort((left, right) =>
        left.name.localeCompare(right.name, "es", { sensitivity: "base" })
      );

      return serializeIngredient(ingredient, ingredient.storeStocks?.[0], {
        affectedProducts: uniqueProducts.length,
        affectedProductNames: uniqueProducts.map((product) => product.name),
      });
    })
    .sort((left, right) => {
      const categoryOrder = String(left.category || "").localeCompare(
        String(right.category || ""),
        "es",
        { sensitivity: "base" }
      );

      return (
        categoryOrder ||
        left.name.localeCompare(right.name, "es", { sensitivity: "base" })
      );
    });
};

router.get("/", async (req, res) => {
  try {
    await ensureIngredientMediaColumns(prisma);

    const storeId = parseId(req.params.storeId);
    if (!storeId) {
      return res.status(400).json({ error: "Invalid storeId" });
    }

    const allowDemoIngredients = await isDemoStore(storeId);
    if (allowDemoIngredients == null) {
      return res.status(404).json({ error: "Store not found" });
    }

    if (req.query.scope === "menu") {
      const scoped = await getMenuScopedIngredients(storeId);
      if (!scoped) {
        return res.status(404).json({ error: "Store not found" });
      }
      return res.json(scoped);
    }

    const ingredients = await prisma.ingredient.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      include: {
        storeStocks: {
          where: { storeId },
        },
      },
    });

    const result = ingredients
      .filter((ing) => allowDemoIngredients || !isDemoIngredient(ing))
      .map((ing) => serializeIngredient(ing, ing.storeStocks[0]));

    res.json(result);
  } catch (err) {
    console.error("[GET store ingredients]", err);
    res.status(500).json({ error: "Error fetching store ingredients" });
  }
});

router.post("/", async (req, res) => {
  try {
    const storeId = parseId(req.params.storeId);
    if (!storeId) {
      return res.status(400).json({ error: "Invalid storeId" });
    }

    const { ingredientIds } = req.body;

    if (!Array.isArray(ingredientIds) || ingredientIds.length === 0) {
      return res.status(400).json({
        error: "ingredientIds must be a non-empty array",
      });
    }

    const normalizedIds = [
      ...new Set(
        ingredientIds
          .map((ingredientId) => parseId(ingredientId))
          .filter(Boolean)
      ),
    ];

    if (!normalizedIds.length) {
      return res.status(400).json({
        error: "ingredientIds must contain valid ids",
      });
    }

    const activeIngredients = await prisma.ingredient.findMany({
      where: {
        id: { in: normalizedIds },
        status: "ACTIVE",
        costPrice: { gt: 0 },
      },
      select: { id: true },
    });
    const onboardableIds = new Set(activeIngredients.map((item) => item.id));
    const blockedIds = normalizedIds.filter((id) => !onboardableIds.has(id));

    if (blockedIds.length) {
      return res.status(400).json({
        error: "Ingredients must be active and priced before onboarding",
        ingredientIds: blockedIds,
      });
    }

    const ops = normalizedIds.map((ingredientId) =>
      prisma.storeIngredientStock.upsert({
        where: {
          storeId_ingredientId: {
            storeId,
            ingredientId,
          },
        },
        update: {
          active: true,
        },
        create: {
          storeId,
          ingredientId,
          stock: 0,
          active: true,
        },
      })
    );

    await Promise.all(ops);

    res.json({
      success: true,
      count: normalizedIds.length,
    });
  } catch (err) {
    console.error("[POST store ingredients]", err);
    res.status(500).json({ error: "Error adding ingredients to store" });
  }
});

router.patch("/:ingredientId", async (req, res) => {
  try {
    const storeId = parseId(req.params.storeId);
    const ingredientId = parseId(req.params.ingredientId);

    if (!storeId || !ingredientId) {
      return res.status(400).json({ error: "Invalid ids" });
    }

    const { active, stock, source, notifyTracking } = req.body;
    const data = {};

    if (active !== undefined) data.active = Boolean(active);

    if (stock !== undefined) {
      const n = Number(stock);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: "Invalid stock" });
      }
      data.stock = Math.trunc(n);
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const previous = await prisma.storeIngredientStock.findUnique({
      where: {
        storeId_ingredientId: {
          storeId,
          ingredientId,
        },
      },
      select: { active: true },
    });

    if (data.active === true) {
      const ingredient = await prisma.ingredient.findUnique({
        where: { id: ingredientId },
        select: { status: true, costPrice: true },
      });

      if (ingredient?.status !== "ACTIVE" || Number(ingredient?.costPrice) <= 0) {
        return res.status(400).json({
          error: "Ingredient must be active and priced before activation",
        });
      }
    }

    if (!previous && data.active !== true) {
      return res.status(409).json({
        error: "Ingredient must be onboarded before deactivation",
      });
    }

    const updated = await prisma.storeIngredientStock.upsert({
      where: {
        storeId_ingredientId: {
          storeId,
          ingredientId,
        },
      },
      update: data,
      create: {
        storeId,
        ingredientId,
        stock: data.stock ?? 0,
        active: data.active ?? true,
      },
    });

    let notification = null;
    const isDisabling = active !== undefined && Boolean(active) === false;
    const wasAlreadyDisabled = previous?.active === false;
    const shouldNotify =
      source === "pos" || notifyTracking === true || notifyTracking === "true";

    if (shouldNotify && isDisabling && !wasAlreadyDisabled) {
      const [store, ingredient] = await Promise.all([
        prisma.store.findUnique({
          where: { id: storeId },
          include: {
            partner: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
        prisma.ingredient.findUnique({
          where: { id: ingredientId },
          select: { id: true, name: true },
        }),
      ]);

      if (store?.partnerId) {
        const partnerRows = await prisma.$queryRawUnsafe(
          "SELECT trackingNotificationSettings FROM Partner WHERE id = ?",
          store.partnerId
        );
        store.partner = {
          ...(store.partner || {}),
          trackingNotificationSettings:
            partnerRows?.[0]?.trackingNotificationSettings || null,
        };
      }

      try {
        notification = await sendIngredientDisabledTrackingSms(prisma, {
          store,
          ingredient,
          stock: updated,
        });
      } catch (notificationError) {
        console.error(
          "[PATCH store ingredient notification]",
          notificationError
        );
        notification = {
          ok: false,
          skipped: true,
          reason: "notification_failed",
        };
      }
    }

    res.json({ ...updated, notification });
  } catch (err) {
    console.error("[PATCH store ingredient]", err);
    res.status(500).json({ error: "Error updating ingredient" });
  }
});

router.delete("/:ingredientId", async (req, res) => {
  try {
    const storeId = parseId(req.params.storeId);
    const ingredientId = parseId(req.params.ingredientId);

    if (!storeId || !ingredientId) {
      return res.status(400).json({ error: "Invalid ids" });
    }

    await prisma.storeIngredientStock.delete({
      where: {
        storeId_ingredientId: {
          storeId,
          ingredientId,
        },
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[DELETE store ingredient]", err);
    res.status(500).json({ error: "Error deleting ingredient" });
  }
});

export default router;
