import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const rows = await prisma.category.findMany({
      orderBy: { name: "asc" },
    });

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load categories" });
  }
});

router.post("/", async (req, res) => {
  try {
    const rawName = String(req.body?.name || "").trim();

    if (!rawName) {
      return res.status(400).json({ error: "name required" });
    }

    const existing = await prisma.category.findFirst({
      where: {
        name: {
          equals: rawName,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return res.status(409).json({ error: "Category already exists" });
    }

    const max = await prisma.category.findFirst({
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const position = (max?.position ?? -1) + 1;

    const row = await prisma.category.create({
      data: {
        name: rawName,
        position,
      },
    });

    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create category" });
  }
});

router.patch("/order", async (req, res) => {
  return res.status(403).json({
    error: "Category order is managed by each partner in Backoffice",
  });
});

router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nextName = String(req.body?.name || "").trim();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid category id" });
    }

    if (!nextName) {
      return res.status(400).json({ error: "name required" });
    }

    const existing = await prisma.category.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ error: "Category not found" });
    }

    const duplicated = await prisma.category.findFirst({
      where: {
        name: nextName,
        NOT: { id },
      },
      select: { id: true },
    });

    if (duplicated) {
      return res.status(409).json({ error: "Category already exists" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const category = await tx.category.update({
        where: { id },
        data: { name: nextName },
      });

      if (existing.name !== nextName) {
        await tx.menuPizza.updateMany({
          where: {
            OR: [
              { category: existing.name },
              { categoryId: id },
            ],
          },
          data: { category: nextName },
        });
      }

      return category;
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update category" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid category id" });
    }

    const existing = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { ingredientExtras: true, partnerCategories: true },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Category not found" });
    }

    const pizzasUsingCategory = await prisma.menuPizza.count({
      where: {
        OR: [
          { categoryId: id },
          { category: existing.name },
        ],
      },
    });

    if (
      existing._count.ingredientExtras > 0 ||
      existing._count.partnerCategories > 0 ||
      pizzasUsingCategory > 0
    ) {
      return res.status(409).json({
        error: "Category is still being used and cannot be deleted",
      });
    }

    await prisma.category.delete({
      where: { id },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

export default router;
