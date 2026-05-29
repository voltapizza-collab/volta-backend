import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();


router.get("/", async (req, res) => {
  try {
    const ingredients = await prisma.ingredient.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.json(ingredients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error fetching ingredients" });
  }
});
router.get("/suggestions", async (req, res) => {
  try {
    const { status } = req.query;

    const where = {};

    if (status) {
      where.status = status.toUpperCase();
    }

    const suggestions = await prisma.ingredientSuggestion.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching suggestions" });
  }
});
router.post("/", async (req, res) => {
  try {
    const { name, category, allergens } = req.body;

    if (!name || !category) {
      return res.status(400).json({
        error: "name and category required",
      });
    }

    const ingredient = await prisma.$transaction(async (tx) => {
      const created = await tx.ingredient.create({
        data: {
          name,
          category,
          allergens: allergens || [],
        },
      });

      const stores = await tx.store.findMany({
        select: { id: true },
      });

      if (stores.length) {
        await tx.storeIngredientStock.createMany({
          data: stores.map((store) => ({
            storeId: store.id,
            ingredientId: created.id,
            stock: 0,
            active: true,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    res.json(ingredient);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error creating ingredient" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid ingredient id" });
    }

    const data = {};

    if (Object.prototype.hasOwnProperty.call(req.body, "costPrice")) {
      if (req.body.costPrice === "" || req.body.costPrice == null) {
        data.costPrice = null;
      } else {
        const costPrice = Number(req.body.costPrice);

        if (!Number.isFinite(costPrice) || costPrice < 0) {
          return res.status(400).json({ error: "Invalid ingredient price" });
        }

        data.costPrice = Math.round(costPrice * 100) / 100;
      }
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const ingredient = await prisma.ingredient.update({
      where: { id },
      data,
    });

    res.json(ingredient);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error updating ingredient" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid ingredient id" });
    }

    const existing = await prisma.ingredient.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    await prisma.$transaction([
      prisma.storeIngredientStock.deleteMany({
        where: { ingredientId: id },
      }),
      prisma.menuPizzaIngredient.deleteMany({
        where: { ingredientId: id },
      }),
      prisma.ingredientExtra.deleteMany({
        where: { ingredientId: id },
      }),
      prisma.ingredient.delete({
        where: { id },
      }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error deleting ingredient" });
  }
});
router.post("/suggestions", async (req, res) => {
  try {
    const { name, category } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: "Missing data" });
    }

    const cleanName = name.trim().toLowerCase();

    // 🔥 evitar duplicado en ingredientes reales
    const existing = await prisma.ingredient.findFirst({
      where: {
        name: cleanName,
      },
    });

    if (existing) {
      return res.status(400).json({
        error: "Ingredient already exists",
      });
    }

    // 🔥 evitar duplicado en sugerencias pendientes
    const existingSuggestion = await prisma.ingredientSuggestion.findFirst({
      where: {
        name: cleanName,
        status: "PENDING",
      },
    });

    if (existingSuggestion) {
      return res.status(400).json({
        error: "Suggestion already submitted",
      });
    }

    const suggestion = await prisma.ingredientSuggestion.create({
      data: {
        name: cleanName,
        category: category.toUpperCase(),
      },
    });

    res.json(suggestion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creating suggestion" });
  }
});
router.patch("/suggestions/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;

    const suggestion = await prisma.ingredientSuggestion.findUnique({
      where: { id: Number(id) },
    });

    if (!suggestion) {
      return res.status(404).json({ error: "Not found" });
    }

    // 🔥 crear ingrediente real
    const result = await prisma.$transaction(async (tx) => {
      const updatedSuggestion = await tx.ingredientSuggestion.update({
        where: { id: Number(id) },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
        },
      });

      const existingIngredient = await tx.ingredient.findFirst({
        where: { name: suggestion.name },
        select: { id: true },
      });

      const ingredient = existingIngredient
        ? await tx.ingredient.update({
            where: { id: existingIngredient.id },
            data: { status: "ACTIVE" },
          })
        : await tx.ingredient.create({
            data: {
              name: suggestion.name,
              category: suggestion.category,
              allergens: [],
            },
          });

      const stores = await tx.store.findMany({
        select: { id: true },
      });

      if (stores.length) {
        await tx.storeIngredientStock.createMany({
          data: stores.map((store) => ({
            storeId: store.id,
            ingredientId: ingredient.id,
            stock: 0,
            active: true,
          })),
          skipDuplicates: true,
        });
      }

      return { suggestion: updatedSuggestion, ingredient };
    });

    // 🔥 marcar como aprobado
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error approving suggestion" });
  }
});
router.patch("/suggestions/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.ingredientSuggestion.update({
      where: { id: Number(id) },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error rejecting suggestion" });
  }
});

export default router;
