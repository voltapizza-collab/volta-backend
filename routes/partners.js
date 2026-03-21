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

export default router;