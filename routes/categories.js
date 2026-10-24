import { categoryBuilder } from '../services/foodPackages.js';
import express from "express";
import prisma from "../services/prisma.js";

const router = express.Router();

const normalizeCategory = (row) => ({
  ...row,
  builderType: categoryBuilder(row),
  customizable: Boolean(row?.customizable),
  halfAndHalf: Boolean(row?.halfAndHalf),
});

const getCategoryById = async (id) => {
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM Category
    WHERE id = ${id}
    LIMIT 1
  `;

  return rows[0] ? normalizeCategory(rows[0]) : null;
};

router.get("/", async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT *
      FROM Category
      ORDER BY name ASC
    `;

    res.json(rows.map(normalizeCategory));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load categories" });
  }
});

router.post("/", async (req, res) => {
  try {
    const rawName = String(req.body?.name || "").trim();
    const builderType = req.body?.builderType ?? (req.body?.customizable ? 'PIZZA' : 'NONE');
    if (!['NONE', 'PIZZA'].includes(builderType)) return res.status(400).json({ error: 'invalid_builder_type' });
    const customizable = builderType === 'PIZZA';
    const halfAndHalf = Boolean(req.body?.halfAndHalf);

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
        builderType,
        customizable,
        position,
      },
    });

    await prisma.$executeRaw`
      UPDATE Category
      SET halfAndHalf = ${halfAndHalf}
      WHERE id = ${row.id}
    `;

    res.json(await getCategoryById(row.id));
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
    const hasCustomizable = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "customizable"
    );
    const hasHalfAndHalf = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "halfAndHalf"
    );

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

    const builderType = req.body.builderType ?? (hasCustomizable ? (req.body.customizable ? 'PIZZA' : 'NONE') : categoryBuilder(existing));
    if (!['NONE', 'PIZZA'].includes(builderType)) return res.status(400).json({ error: 'invalid_builder_type' });
    const updated = await prisma.$transaction(async (tx) => {
      const category = await tx.category.update({
        where: { id },
        data: {
          name: nextName,
          builderType,
          customizable: builderType === "PIZZA",
        },
      });

      if (hasHalfAndHalf) {
        await tx.$executeRaw`
          UPDATE Category
          SET halfAndHalf = ${Boolean(req.body.halfAndHalf)}
          WHERE id = ${id}
        `;
      }

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

    res.json(await getCategoryById(updated.id));
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

    const packages = await prisma.foodPackage.findMany();
    if (packages.some(pack => pack.categoryIds.includes(id))) return res.status(409).json({ error: 'Category belongs to a food package' });
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
