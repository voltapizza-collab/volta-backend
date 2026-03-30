import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

/* ===============================
   GET MENU (PRIMERO ⚠️)
================================ */

router.get("/:partnerSlug/:storeSlug/menu", async (req, res) => {
  try {
    const { partnerSlug, storeSlug } = req.params;

    // 🔥 1. buscar partner
    const partner = await prisma.partner.findUnique({
      where: { slug: partnerSlug },
    });

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    // 🔥 2. buscar store por partnerId + slug
    const store = await prisma.store.findFirst({
      where: {
        slug: storeSlug,
        partnerId: partner.id,
      },
    });

    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    // 🔥 3. menú
const menu = await prisma.storePizzaStock.findMany({
  where: {
    storeId: store.id,
    active: true,
  },
  include: {
    pizza: true,
  },
});

    res.json(menu);
  } catch (e) {
    console.error("GET MENU ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ===============================
   GET STORE
================================ */

router.get("/:partnerSlug/:storeSlug", async (req, res) => {
  try {
    const { partnerSlug, storeSlug } = req.params;

    // 🔥 1. buscar partner
    const partner = await prisma.partner.findUnique({
      where: { slug: partnerSlug },
    });

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    // 🔥 2. buscar store
    const store = await prisma.store.findFirst({
      where: {
        slug: storeSlug,
        partnerId: partner.id,
      },
      include: {
        partner: true,
      },
    });

    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    res.json(store);
  } catch (e) {
    console.error("GET STORE ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ===============================
   CREATE STORE
================================ */

router.post("/", async (req, res) => {
  try {
    const { storeName, slug, partnerId, address } = req.body;

    const store = await prisma.store.create({
      data: {
        storeName,
        slug,
        partnerId,
        address: address || "",
      },
    });

    res.json(store);
  } catch (e) {
    console.error("CREATE STORE ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;