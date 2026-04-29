import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

const upload = multer({ storage: multer.memoryStorage() });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseNullableDate = (value) => {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseItems = (value) => {
  const source = typeof value === "string" ? JSON.parse(value || "[]") : value;
  if (!Array.isArray(source)) return [];

  return source
    .map((item) => ({
      pizzaId: parsePositiveInt(item?.pizzaId),
      name: String(item?.name || "").trim(),
      category: item?.category ? String(item.category).trim() : null,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      size: item?.size ? String(item.size).trim() : null,
    }))
    .filter((item) => item.pizzaId && item.name);
};

const uploadPromoImage = async (file, partnerId) => {
  if (!file) return { image: null, imagePublicId: null };

  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    { folder: `volta/partners/${partnerId}/promos` }
  );

  return {
    image: result.secure_url,
    imagePublicId: result.public_id,
  };
};

const serializePromo = (promo) => ({
  id: promo.id,
  partnerId: promo.partnerId,
  title: promo.title,
  description: promo.description,
  items: Array.isArray(promo.items) ? promo.items : [],
  totalPrice: Number(promo.totalPrice || 0),
  activeFrom: promo.activeFrom,
  expiresAt: promo.expiresAt,
  image: promo.image,
  status: promo.status,
  createdAt: promo.createdAt,
});

export default function promosRoutes(prisma) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    try {
      const promos = await prisma.promo.findMany({
        where: { partnerId },
        orderBy: { createdAt: "desc" },
      });

      return res.json({ ok: true, promos: promos.map(serializePromo) });
    } catch (error) {
      console.error("[promos.get] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/", upload.single("image"), async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    const title = String(req.body.title || "").trim();
    const totalPrice = Number(req.body.totalPrice || 0);
    let items = [];

    try {
      items = parseItems(req.body.items);
    } catch {
      return res.status(400).json({ ok: false, error: "bad_items" });
    }

    if (!partnerId || !title || !items.length || !Number.isFinite(totalPrice)) {
      return res.status(400).json({ ok: false, error: "bad_payload" });
    }

    try {
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
        select: { id: true },
      });

      if (!partner) {
        return res.status(404).json({ ok: false, error: "partner_not_found" });
      }

      const { image, imagePublicId } = await uploadPromoImage(req.file, partnerId);
      const promo = await prisma.promo.create({
        data: {
          partnerId,
          title,
          description: req.body.description
            ? String(req.body.description).trim()
            : null,
          items,
          totalPrice,
          activeFrom: parseNullableDate(req.body.activeFrom),
          expiresAt: parseNullableDate(req.body.expiresAt),
          image,
          imagePublicId,
          status: req.body.status ? String(req.body.status) : "ACTIVE",
        },
      });

      return res.json({ ok: true, promo: serializePromo(promo) });
    } catch (error) {
      console.error("[promos.post] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.put("/:id", upload.single("image"), async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const partnerId = parsePositiveInt(req.body.partnerId);
    const title = String(req.body.title || "").trim();
    const totalPrice = Number(req.body.totalPrice || 0);
    let items = [];

    try {
      items = parseItems(req.body.items);
    } catch {
      return res.status(400).json({ ok: false, error: "bad_items" });
    }

    if (!id || !partnerId || !title || !items.length || !Number.isFinite(totalPrice)) {
      return res.status(400).json({ ok: false, error: "bad_payload" });
    }

    try {
      const existing = await prisma.promo.findFirst({
        where: { id, partnerId },
      });

      if (!existing) {
        return res.status(404).json({ ok: false, error: "promo_not_found" });
      }

      let image = existing.image;
      let imagePublicId = existing.imagePublicId;

      if (req.file) {
        if (imagePublicId) {
          await cloudinary.uploader.destroy(imagePublicId);
        }

        const uploadedImage = await uploadPromoImage(req.file, partnerId);
        image = uploadedImage.image;
        imagePublicId = uploadedImage.imagePublicId;
      }

      const promo = await prisma.promo.update({
        where: { id },
        data: {
          title,
          description: req.body.description
            ? String(req.body.description).trim()
            : null,
          items,
          totalPrice,
          activeFrom: parseNullableDate(req.body.activeFrom),
          expiresAt: parseNullableDate(req.body.expiresAt),
          image,
          imagePublicId,
          status: req.body.status ? String(req.body.status) : existing.status,
        },
      });

      return res.json({ ok: true, promo: serializePromo(promo) });
    } catch (error) {
      console.error("[promos.put] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const partnerId = parsePositiveInt(req.query.partnerId);

    if (!id || !partnerId) {
      return res.status(400).json({ ok: false, error: "bad_payload" });
    }

    try {
      const existing = await prisma.promo.findFirst({
        where: { id, partnerId },
      });

      if (!existing) {
        return res.status(404).json({ ok: false, error: "promo_not_found" });
      }

      if (existing.imagePublicId) {
        await cloudinary.uploader.destroy(existing.imagePublicId);
      }

      await prisma.promo.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (error) {
      console.error("[promos.delete] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  return router;
}
