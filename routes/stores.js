import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

// GET store por slug
router.get("/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const store = await prisma.store.findFirst({
      where: { slug },
      include: { partner: true }
    });

    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    res.json(store);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;