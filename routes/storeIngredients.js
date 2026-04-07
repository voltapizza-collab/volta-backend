import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router({ mergeParams: true });

// helper seguro
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

/*
 * GET /stores/:storeId/ingredients
 * → devuelve TODOS los ingredientes + estado en la tienda
 */
router.get("/", async (req, res) => {
  try {
    const storeId = parseId(req.params.storeId);
    if (!storeId) {
      return res.status(400).json({ error: "Invalid storeId" });
    }

    const ingredients = await prisma.ingredient.findMany({
      orderBy: { name: "asc" },
      include: {
        storeStocks: {
          where: { storeId },
        },
      },
    });

    const result = ingredients.map((ing) => {
      const storeStock = ing.storeStocks[0];

      return {
        id: ing.id,
        name: ing.name,
        category: ing.category,
        allergens: normalizeAllergens(ing.allergens),
        unit: ing.unit,
        costPrice: ing.costPrice,

        // 🔥 NUEVO MODELO VOLTA
        exists: !!storeStock,
        active: storeStock ? storeStock.active : false,
        stock: storeStock ? storeStock.stock : 0,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("[GET store ingredients]", err);
    res.status(500).json({ error: "Error fetching store ingredients" });
  }
});

/*
 * POST /stores/:storeId/ingredients
 * BODY: { ingredientIds: [1,2,3] }
 * → añade ingredientes a la tienda (UPSERT)
 */
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

    const ops = ingredientIds.map((ingredientId) =>
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
      count: ingredientIds.length,
    });
  } catch (err) {
    console.error("[POST store ingredients]", err);
    res.status(500).json({ error: "Error adding ingredients to store" });
  }
});

/*
 * PATCH /stores/:storeId/ingredients/:ingredientId
 * → actualizar stock o active
 */
router.patch("/:ingredientId", async (req, res) => {
  try {
    const storeId = parseId(req.params.storeId);
    const ingredientId = parseId(req.params.ingredientId);

    if (!storeId || !ingredientId) {
      return res.status(400).json({ error: "Invalid ids" });
    }

    const { active, stock } = req.body;
    const data = {};

    if (active !== undefined) data.active = Boolean(active);

    if (stock !== undefined) {
      const n = Number(stock);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: "Invalid stock" });
      }
      data.stock = Math.trunc(n);
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

    res.json(updated);
  } catch (err) {
    console.error("[PATCH store ingredient]", err);
    res.status(500).json({ error: "Error updating ingredient" });
  }
});

/*
 * DELETE /stores/:storeId/ingredients/:ingredientId
 * → elimina el ingrediente de la tienda
 */
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
