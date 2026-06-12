import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { ensureIngredientMediaColumns } from "../services/ingredientMediaColumns.js";
import { assertCloudinaryConfigured } from "../services/cloudinaryConfig.js";
import prisma from "../services/prisma.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const DEMO_INGREDIENT_NAMES = new Set([
  "mozzarella demo",
  "pepperoni demo",
  "tomate san marzano demo",
  "champinones demo",
]);

const parseMaybeJson = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeText = (value, max = 400) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const normalizeAllergens = (value) => {
  const parsed = parseMaybeJson(value, value);
  return Array.isArray(parsed)
    ? parsed.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
};

const isDemoIngredient = (ingredient) =>
  DEMO_INGREDIENT_NAMES.has(String(ingredient?.name || "").trim().toLowerCase());

const uploadIngredientImage = async (file, ingredientId) => {
  if (!file) return null;

  assertCloudinaryConfigured();

  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    { folder: `volta/ingredients/${ingredientId}` }
  );

  return {
    image: result.secure_url,
    imagePublicId: result.public_id,
  };
};

const getErrorStatus = (err, fallback = 400) => {
  if (err?.status) return err.status;
  if (["P1001", "P1002", "P1017"].includes(err?.code)) return 503;
  return fallback;
};

router.get("/", async (req, res) => {
  try {
    await ensureIngredientMediaColumns(prisma);

    const ingredients = await prisma.ingredient.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.json(ingredients.filter((ingredient) => !isDemoIngredient(ingredient)));
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
router.post("/", upload.single("image"), async (req, res) => {
  try {
    await ensureIngredientMediaColumns(prisma);

    const { name, category, allergens, description } = req.body;

    if (!name || !category) {
      return res.status(400).json({
        error: "name and category required",
      });
    }

    const ingredient = await prisma.$transaction(async (tx) => {
      const created = await tx.ingredient.create({
        data: {
          name: normalizeText(name, 120),
          category: normalizeText(category, 80).toUpperCase(),
          allergens: normalizeAllergens(allergens),
          description: normalizeText(description, 420) || null,
        },
      });

      return created;
    });

    if (!req.file) {
      return res.json(ingredient);
    }

    let uploadedImage = null;

    try {
      uploadedImage = await uploadIngredientImage(req.file, ingredient.id);
      const updated = await prisma.ingredient.update({
        where: { id: ingredient.id },
        data: uploadedImage,
      });
      return res.json(updated);
    } catch (uploadError) {
      if (uploadedImage?.imagePublicId) {
        await cloudinary.uploader.destroy(uploadedImage.imagePublicId).catch(() => {});
      }
      throw uploadError;
    }
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({ error: err.message || "error creating ingredient" });
  }
});

router.patch("/:id", upload.single("image"), async (req, res) => {
  try {
    await ensureIngredientMediaColumns(prisma);

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid ingredient id" });
    }

    const data = {};

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      const name = normalizeText(req.body.name, 120);
      if (!name) {
        return res.status(400).json({ error: "Invalid ingredient name" });
      }
      data.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "category")) {
      const category = normalizeText(req.body.category, 80).toUpperCase();
      if (!category) {
        return res.status(400).json({ error: "Invalid ingredient category" });
      }
      data.category = category;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
      data.description = normalizeText(req.body.description, 420) || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "allergens")) {
      data.allergens = normalizeAllergens(req.body.allergens);
    }

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

    const existing = await prisma.ingredient.findUnique({
      where: { id },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Ingredient not found" });
    }

    let uploadedImage = null;

    if (req.file) {
      uploadedImage = await uploadIngredientImage(req.file, id);
      Object.assign(data, uploadedImage);
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const ingredient = await prisma.ingredient.update({ where: { id }, data });

    if (uploadedImage?.imagePublicId && existing.imagePublicId) {
      await cloudinary.uploader.destroy(existing.imagePublicId).catch((error) => {
        console.error("Cloudinary old ingredient image cleanup failed:", error);
      });
    }

    res.json(ingredient);
  } catch (err) {
    console.error(err);
    res.status(getErrorStatus(err, 500)).json({ error: err.message || "error updating ingredient" });
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
      select: { id: true, imagePublicId: true },
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

    if (existing.imagePublicId) {
      assertCloudinaryConfigured();
      await cloudinary.uploader.destroy(existing.imagePublicId).catch((error) => {
        console.error("Cloudinary ingredient image cleanup failed:", error);
      });
    }

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
