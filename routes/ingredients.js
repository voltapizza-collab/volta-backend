import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

/* =========================
   GET INGREDIENTS
========================= */
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

/* =========================
   GET SUGGESTIONS
========================= */
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

/* =========================
   CREATE INGREDIENT
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, category, allergens } = req.body;

    if (!name || !category) {
      return res.status(400).json({
        error: "name and category required",
      });
    }

    const ingredient = await prisma.ingredient.create({
      data: {
        name,
        category,
        allergens: allergens || [],
      },
    });

    res.json(ingredient);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "error creating ingredient" });
  }
});

/* =========================
   CREATE SUGGESTION
========================= */
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

/* =========================
   APPROVE SUGGESTION
========================= */
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
    const newIngredient = await prisma.ingredient.create({
      data: {
        name: suggestion.name,
        category: suggestion.category,
      },
    });

    // 🔥 marcar como aprobado
    await prisma.ingredientSuggestion.update({
      where: { id: Number(id) },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
      },
    });

    res.json(newIngredient);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error approving suggestion" });
  }
});

/* =========================
   REJECT SUGGESTION
========================= */
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