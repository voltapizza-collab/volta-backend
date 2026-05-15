import express from "express";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseNullableDate = (value) => {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseNullableMinutes = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 24 * 60 ? parsed : null;
};

const esDayToNum = (value) => {
  const map = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };

  return map[String(value || "").trim().toLowerCase()] ?? null;
};

const normalizeDaysActive = (value) => {
  if (!value) return [];
  let list = value;

  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = value.split(",");
    }
  }

  if (!Array.isArray(list)) return [];

  return [
    ...new Set(
      list
        .map((item) => {
          if (typeof item === "number" && item >= 0 && item <= 6) return item;
          return esDayToNum(item);
        })
        .filter((item) => item != null)
    ),
  ].sort();
};

const normalizeIds = (value) => {
  if (!value) return [];
  let list = value;

  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = value.split(",");
    }
  }

  if (!Array.isArray(list)) return [];

  return [
    ...new Set(
      list
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    ),
  ];
};

const normalizeNames = (value) => {
  if (!value) return [];
  let list = value;

  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = value.split(",");
    }
  }

  if (!Array.isArray(list)) return [];

  return [
    ...new Set(
      list
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    ),
  ];
};

const serializeDirectDiscount = (discount) => ({
  id: discount.id,
  partnerId: discount.partnerId,
  title: discount.title,
  discountType: discount.discountType,
  value: Number(discount.value || 0),
  targetType: discount.targetType,
  productIds: normalizeIds(discount.productIds),
  categoryIds: normalizeIds(discount.categoryIds),
  categoryNames: normalizeNames(discount.categoryNames),
  storeIds: normalizeIds(discount.storeIds),
  activeFrom: discount.activeFrom,
  expiresAt: discount.expiresAt,
  daysActive: normalizeDaysActive(discount.daysActive),
  windowStart: discount.windowStart,
  windowEnd: discount.windowEnd,
  status: discount.status,
  createdAt: discount.createdAt,
});

const buildPayload = (body) => {
  const discountType = String(body.discountType || "").toUpperCase();
  const targetType = String(body.targetType || "").toUpperCase();

  return {
    partnerId: parsePositiveInt(body.partnerId),
    title: String(body.title || "").trim(),
    discountType,
    value: Number(body.value),
    targetType,
    productIds: normalizeIds(body.productIds),
    categoryIds: normalizeIds(body.categoryIds),
    categoryNames: normalizeNames(body.categoryNames),
    storeIds: normalizeIds(body.storeIds),
    activeFrom: parseNullableDate(body.activeFrom),
    expiresAt: parseNullableDate(body.expiresAt),
    daysActive: normalizeDaysActive(body.daysActive),
    windowStart: parseNullableMinutes(body.windowStart),
    windowEnd: parseNullableMinutes(body.windowEnd),
    status: body.status ? String(body.status).toUpperCase() : "ACTIVE",
  };
};

const validatePayload = (payload) => {
  if (!payload.partnerId || !payload.title) return "bad_payload";
  if (!["PERCENT", "FIXED_AMOUNT"].includes(payload.discountType)) return "bad_discount_type";
  if (!Number.isFinite(payload.value) || payload.value <= 0) return "bad_value";
  if (payload.discountType === "PERCENT" && payload.value > 100) return "bad_percent";
  if (!["CATEGORY", "PRODUCT"].includes(payload.targetType)) return "bad_target_type";
  if (payload.targetType === "PRODUCT" && !payload.productIds.length) return "missing_products";
  if (
    payload.targetType === "CATEGORY" &&
    !payload.categoryIds.length &&
    !payload.categoryNames.length
  ) {
    return "missing_categories";
  }
  return null;
};

const verifyOwnership = async (prisma, payload) => {
  const partner = await prisma.partner.findUnique({
    where: { id: payload.partnerId },
    select: { id: true },
  });
  if (!partner) return "partner_not_found";

  if (payload.storeIds.length) {
    const count = await prisma.store.count({
      where: { partnerId: payload.partnerId, id: { in: payload.storeIds } },
    });
    if (count !== payload.storeIds.length) return "bad_store_ids";
  }

  if (payload.productIds.length) {
    const count = await prisma.menuPizza.count({
      where: { partnerId: payload.partnerId, id: { in: payload.productIds } },
    });
    if (count !== payload.productIds.length) return "bad_product_ids";
  }

  return null;
};

export default function directDiscountsRoutes(prisma) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    try {
      const discounts = await prisma.directDiscount.findMany({
        where: { partnerId },
        orderBy: { createdAt: "desc" },
      });

      return res.json({ ok: true, discounts: discounts.map(serializeDirectDiscount) });
    } catch (error) {
      console.error("[direct-discounts.get] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/", async (req, res) => {
    const payload = buildPayload(req.body);
    const validationError = validatePayload(payload);

    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    try {
      const ownershipError = await verifyOwnership(prisma, payload);
      if (ownershipError) {
        return res.status(400).json({ ok: false, error: ownershipError });
      }

      const discount = await prisma.directDiscount.create({
        data: payload,
      });

      return res.json({ ok: true, discount: serializeDirectDiscount(discount) });
    } catch (error) {
      console.error("[direct-discounts.post] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.put("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const payload = buildPayload(req.body);
    const validationError = validatePayload(payload);

    if (!id || validationError) {
      return res.status(400).json({ ok: false, error: validationError || "bad_id" });
    }

    try {
      const existing = await prisma.directDiscount.findFirst({
        where: { id, partnerId: payload.partnerId },
      });

      if (!existing) {
        return res.status(404).json({ ok: false, error: "discount_not_found" });
      }

      const ownershipError = await verifyOwnership(prisma, payload);
      if (ownershipError) {
        return res.status(400).json({ ok: false, error: ownershipError });
      }

      const discount = await prisma.directDiscount.update({
        where: { id },
        data: payload,
      });

      return res.json({ ok: true, discount: serializeDirectDiscount(discount) });
    } catch (error) {
      console.error("[direct-discounts.put] error:", error);
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
      const existing = await prisma.directDiscount.findFirst({
        where: { id, partnerId },
      });

      if (!existing) {
        return res.status(404).json({ ok: false, error: "discount_not_found" });
      }

      await prisma.directDiscount.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (error) {
      console.error("[direct-discounts.delete] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  return router;
}
