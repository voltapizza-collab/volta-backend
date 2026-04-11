import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

// crear partner
router.post("/", async (req, res) => {
  try {
    const data = req.body;
    const partner = await prisma.partner.create({ data });
    res.json(partner);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// listar partners
router.get("/", async (req, res) => {
  const list = await prisma.partner.findMany({
    include: { stores: true }
  });
  res.json(list);
});

router.get("/:slug", async (req, res) => {
  try {
    const partner = await prisma.partner.findUnique({
      where: { slug: req.params.slug },
      include: {
        stores: {
          where: { active: true },
          orderBy: { storeName: "asc" },
        },
      },
    });

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    res.json(partner);
  } catch (e) {
    console.error("GET PARTNER BY SLUG ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
