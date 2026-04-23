import express from "express";
import axios from "axios";

const GOOGLE = process.env.GOOGLE_GEOCODING_KEY;
const COLD_DAYS_THRESHOLD = 15;

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeDigits = (value) => String(value || "").replace(/\D/g, "");

const esBase9 = (phone) => {
  const digits = normalizeDigits(phone);
  if (digits.length === 9) return digits;
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  if (digits.length > 9 && digits.endsWith(digits.slice(-9))) return digits.slice(-9);
  return null;
};

const toE164ES = (phone) => {
  const base9 = esBase9(phone);
  return base9 ? `+34${base9}` : null;
};

const createWhereByPartner = (partnerId, extra = {}) => ({
  partnerId,
  ...extra,
});

const extractZipCode = (value) => {
  const match = String(value || "").match(/\b(\d{5})\b/);
  return match ? match[1] : null;
};

const resolveCustomerZipCode = (address, explicitZip) => {
  const directZip = String(explicitZip || "").trim();
  if (directZip) return directZip;
  return extractZipCode(address);
};

const normalizeComparableText = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const postalAreaKey = (postalCode) => {
  const digits = String(postalCode || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(0, 3) : "";
};

const CUSTOMER_SEGMENTS = ["S1", "S2", "S3", "S4", "S5"];

const getCustomerActivity = (daysOff) =>
  Number(daysOff || 0) > COLD_DAYS_THRESHOLD ? "COLD" : "HOT";

async function buildCustomerWhere(prisma, filters) {
  const {
    partnerId,
    query = "",
    zip = "",
    storeId = null,
    country = "",
    segment = "",
    temperature = "",
  } = filters;

  const digits = String(query || "").replace(/\D/g, "");
  const extraWhere = {};
  const andFilters = [];

  if (digits) {
    extraWhere.phone = { contains: digits };
  }

  if (zip) {
    andFilters.push({
      OR: [
        { zipCode: zip },
        { address_1: { contains: zip } },
      ],
    });
  }

  if (segment && CUSTOMER_SEGMENTS.includes(segment)) {
    extraWhere.segment = segment;
  }

  if (temperature === "COLD") {
    extraWhere.daysOff = { gt: COLD_DAYS_THRESHOLD };
  } else if (temperature === "HOT") {
    extraWhere.daysOff = { lte: COLD_DAYS_THRESHOLD };
  }

  if (storeId) {
    const selectedStore = await prisma.store.findFirst({
      where: {
        id: storeId,
        partnerId,
      },
      select: {
        id: true,
        zipCode: true,
        city: true,
      },
    });

    if (!selectedStore) {
      return { where: null, empty: true };
    }

    const storeZip = String(selectedStore.zipCode || "").trim();
    const storeArea = postalAreaKey(storeZip);
    const storeCity = normalizeComparableText(selectedStore.city || "");

    andFilters.push({
      OR: [
        {
          sales: {
            some: {
              storeId,
            },
          },
        },
        ...(storeZip
          ? [
              { zipCode: storeZip },
              { address_1: { contains: storeZip } },
            ]
          : []),
        ...(storeArea
          ? [
              { zipCode: { startsWith: storeArea } },
              { address_1: { contains: storeArea } },
            ]
          : []),
        ...(storeCity
          ? [{ address_1: { contains: storeCity, mode: "insensitive" } }]
          : []),
      ],
    });
  }

  if (country) {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { country: true },
    });

    if (!partner || String(partner.country || "").trim().toUpperCase() !== country) {
      return { where: null, empty: true };
    }
  }

  if (andFilters.length) {
    extraWhere.AND = andFilters;
  }

  return {
    where: createWhereByPartner(partnerId, extraWhere),
    empty: false,
  };
}

export default function customersRoutes(prisma) {
  const router = express.Router();

  async function genCustomerCode() {
    let code;
    do {
      code = `CUS-${Math.floor(10000 + Math.random() * 90000)}`;
    } while (await prisma.customer.findUnique({ where: { code } }));
    return code;
  }

  async function findByBase9(partnerId, base9) {
    return prisma.customer.findFirst({
      where: createWhereByPartner(partnerId, {
        phone: { contains: base9 },
      }),
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        email: true,
        address_1: true,
        portal: true,
        observations: true,
        isRestricted: true,
        restrictedAt: true,
        restrictionReason: true,
        segment: true,
        segmentUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  router.get("/", async (req, res) => {
    try {
      const partnerId = req.query.partnerId
        ? parsePositiveInt(req.query.partnerId)
        : null;

      const where = partnerId ? { partnerId } : undefined;

      const list = await prisma.customer.findMany({
        where,
        select: {
          id: true,
          partnerId: true,
          name: true,
          phone: true,
          address_1: true,
          zipCode: true,
          lat: true,
          lng: true,
          daysOff: true,
          segment: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      return res.json(list);
    } catch (error) {
      console.error("[CUSTOMERS /] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.get("/admin", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const query = String(req.query.q || "").trim();
    const zip = String(req.query.zip || "").trim();
    const storeId = parsePositiveInt(req.query.storeId);
    const country = String(req.query.country || "").trim().toUpperCase();
    const segment = String(req.query.segment || "").trim().toUpperCase();
    const temperature = String(req.query.temperature || "").trim().toUpperCase();
    const take = Math.min(parsePositiveInt(req.query.take) || 50, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId required" });
    }

    const digits = query.replace(/\D/g, "");

    const extraWhere = {};
    const andFilters = [];

    // filtro por phone
    if (digits) {
      extraWhere.phone = { contains: digits };
    }

    if (zip) {
      andFilters.push({
        OR: [
        { zipCode: zip },
        { address_1: { contains: zip } },
        ],
      });
    }

    // 🔥 filtro por segmento
    if (segment && CUSTOMER_SEGMENTS.includes(segment)) {
      extraWhere.segment = segment;
    }

    if (temperature === "COLD") {
      extraWhere.daysOff = { gt: COLD_DAYS_THRESHOLD };
    } else if (temperature === "HOT") {
      extraWhere.daysOff = { lte: COLD_DAYS_THRESHOLD };
    }

    try {
      let selectedStore = null;

      if (storeId) {
        selectedStore = await prisma.store.findFirst({
          where: {
            id: storeId,
            partnerId,
          },
          select: {
            id: true,
            zipCode: true,
            city: true,
          },
        });

        if (!selectedStore) {
          return res.json({ items: [], total: 0, skip, take });
        }

        const storeZip = String(selectedStore.zipCode || "").trim();
        const storeArea = postalAreaKey(storeZip);
        const storeCity = normalizeComparableText(selectedStore.city || "");

        andFilters.push({
          OR: [
          {
            sales: {
              some: {
                storeId,
              },
            },
          },
          ...(storeZip
            ? [
                { zipCode: storeZip },
                { address_1: { contains: storeZip } },
              ]
            : []),
          ...(storeArea
            ? [
                { zipCode: { startsWith: storeArea } },
                { address_1: { contains: storeArea } },
              ]
            : []),
          ...(storeCity
            ? [{ address_1: { contains: storeCity, mode: "insensitive" } }]
            : []),
          ],
        });
      }

      if (country) {
        const partner = await prisma.partner.findUnique({
          where: { id: partnerId },
          select: { country: true },
        });

        if (!partner || String(partner.country || "").trim().toUpperCase() !== country) {
          return res.json({ items: [], total: 0, skip, take });
        }
      }

      if (andFilters.length) {
        extraWhere.AND = andFilters;
      }

      const where = createWhereByPartner(partnerId, extraWhere);

      const [items, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            email: true,
            address_1: true,
            zipCode: true,
            portal: true,
            observations: true,
            isRestricted: true,
            restrictedAt: true,
            restrictionReason: true,
            segment: true,
            segmentUpdatedAt: true,
            daysOff: true, 
            createdAt: true,
            updatedAt: true,
          },
          skip,
          take,
        }),
        prisma.customer.count({ where }),
      ]);

      return res.json({ items, total, skip, take });
    } catch (error) {
      console.error("[CUSTOMERS /admin] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.get("/search", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const query = String(req.query.q || "").trim();

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId required" });
    }

    if (!query) return res.json([]);

    const digits = query.replace(/\D/g, "");
    const text = query.toUpperCase();

    try {
      const found = await prisma.customer.findMany({
        where: createWhereByPartner(partnerId, {
          OR: [
            digits ? { phone: { contains: digits } } : undefined,
            { address_1: { contains: text } },
            { name: { contains: query } },
          ].filter(Boolean),
        }),
        take: 5,
        orderBy: { updatedAt: "desc" },
      });

      return res.json(found);
    } catch (error) {
      console.error("[CUSTOMERS /search] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.get("/segment-stats", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId required" });
    }

    try {
      const [bySeg, total, restricted, cold, zipRows] = await Promise.all([
        prisma.customer.groupBy({
          by: ["segment"],
          where: { partnerId },
          _count: { _all: true },
        }),
        prisma.customer.count({ where: { partnerId } }),
        prisma.customer.count({
          where: {
            partnerId,
            isRestricted: true,
          },
        }),
        prisma.customer.count({
          where: {
            partnerId,
            daysOff: { gt: COLD_DAYS_THRESHOLD },
          },
        }),
        prisma.customer.findMany({
          where: { partnerId },
          select: {
            zipCode: true,
            address_1: true,
          },
        }),
      ]);

      const counts = { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };
      const zipCodes = [...new Set(
        zipRows
          .map((row) => row.zipCode || extractZipCode(row.address_1))
          .filter(Boolean)
      )].sort((left, right) => String(left).localeCompare(String(right)));

      bySeg.forEach((row) => {
        if (row.segment && Object.prototype.hasOwnProperty.call(counts, row.segment)) {
          counts[row.segment] = row._count._all || 0;
        }
      });

      return res.json({
        total,
        counts,
        active: {
          restricted,
          unrestricted: Math.max(total - restricted, 0),
        },
        temperature: {
          cold,
          hot: Math.max(total - cold, 0),
        },
        zipCodes,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[CUSTOMERS /segment-stats] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.get("/restriction", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const query = req.query.phone || req.query.q || "";
    const base9 = esBase9(query);

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId required" });
    }

    if (!base9) {
      return res.json({
        exists: false,
        isRestricted: 0,
        restricted: false,
        reason: "",
        code: "",
      });
    }

    try {
      const customer = await findByBase9(partnerId, base9);

      if (!customer) {
        return res.json({
          exists: false,
          isRestricted: 0,
          restricted: false,
          reason: "",
          code: "",
        });
      }

      const isRestricted = Boolean(customer.isRestricted);

      return res.json({
        exists: true,
        isRestricted: isRestricted ? 1 : 0,
        restricted: isRestricted,
        reason: customer.restrictionReason || "",
        code: customer.code || "",
        restrictedAt: customer.restrictedAt || null,
      });
    } catch (error) {
      console.error("[CUSTOMERS /restriction] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.post("/resegment", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId || req.query.partnerId);

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId required" });
    }

    try {
      const sales = await prisma.sale.findMany({
        where: { partnerId },
        select: {
          total: true,
          createdAt: true,
          customerId: true,
        },
      });

      const customers = await prisma.customer.findMany({
        where: { partnerId },
        select: {
          id: true,
          segment: true,
          daysOff: true,
          sales: {
            select: {
              total: true,
              createdAt: true,
            },
          },
        },
      });

      const updates = [];
      const counts = { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };
      let changed = 0;

      customers.forEach((customer) => {
        const rows = (customer.sales || [])
          .map((row) => ({
            total: Number(row.total || 0),
            createdAt: row.createdAt,
          }))
          .filter((row) => Number.isFinite(row.total) && row.total > 0)
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

        const orders = rows.length;
        const sum = rows.reduce((acc, row) => acc + row.total, 0);
        const avg = orders ? sum / orders : 0;
        const lastTicket = rows[0]?.total || 0;
        const targetTicket = avg * 1.15;

        let segment = "S1";
        if (orders === 0) {
          segment = "S1";
        } else if (orders === 1) {
          segment = "S2";
        } else if (lastTicket >= targetTicket) {
          segment = "S5";
        } else if (lastTicket < avg) {
          segment = "S3";
        } else {
          segment = "S4";
        }

        counts[segment] += 1;
        const activity = getCustomerActivity(customer.daysOff);

        if (segment !== customer.segment) {
          changed += 1;
        }

        updates.push(
          prisma.customer.update({
            where: { id: customer.id },
            data: {
              segment,
              activity,
              segmentUpdatedAt: new Date(),
            },
          })
        );
      });

      if (updates.length) {
        await prisma.$transaction(updates);
      }

      return res.json({ ok: true, changed, counts });
    } catch (error) {
      console.error("[CUSTOMERS /resegment] error:", error);
      return res.status(500).json({
        error: "internal",
        message: error?.message || "unknown",
      });
    }
  });

  router.get("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "invalid_id" });
    }

    try {
      const customer = await prisma.customer.findUnique({
        where: { id },
        select: {
          id: true,
          partnerId: true,
          code: true,
          name: true,
          phone: true,
          email: true,
          address_1: true,
          portal: true,
          observations: true,
          lat: true,
          lng: true,
          segment: true,
          isRestricted: true,
          restrictedAt: true,
          restrictionReason: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!customer) {
        return res.status(404).json({ error: "not_found" });
      }

      return res.json(customer);
    } catch (error) {
      console.error("[CUSTOMERS /:id] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const partnerId = parsePositiveInt(req.body.partnerId);
      if (!partnerId) {
        return res.status(400).json({ error: "partnerId required" });
      }

      const normalizedPhone = toE164ES(req.body.phone);
      const base9 = esBase9(req.body.phone);

      if (!normalizedPhone || !base9) {
        return res.status(400).json({ error: "invalid_phone" });
      }

      const existing = await findByBase9(partnerId, base9);
      if (existing) {
        return res.status(409).json({ error: "phone_exists", customer: existing });
      }

      let address = String(req.body.address_1 || "").trim();
      if (!address) {
        address = `(PICKUP) ${normalizedPhone}`;
      }

      const geo = {};
      const latNum = Number(req.body.lat);
      const lngNum = Number(req.body.lng);

      if (Number.isFinite(latNum)) geo.lat = latNum;
      if (Number.isFinite(lngNum)) geo.lng = lngNum;

      const isPickup = /^\(PICKUP\)/i.test(address);

      if (!isPickup && (!geo.lat || !geo.lng) && GOOGLE) {
        try {
          const response = await axios.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            {
              params: {
                address,
                components: "country:ES",
                key: GOOGLE,
              },
            }
          );

          const location = response.data?.results?.[0]?.geometry?.location;
          if (location && typeof location.lat === "number" && typeof location.lng === "number") {
            geo.lat = location.lat;
            geo.lng = location.lng;
          }
        } catch (error) {
          console.warn("[CUSTOMERS POST] Geocode error:", error?.message || error);
        }
      }

      const code = await genCustomerCode();
      const zipCode = resolveCustomerZipCode(address, req.body.zipCode);

      const saved = await prisma.customer.create({
        data: {
          partnerId,
          code,
          origin: "PHONE",
          name: req.body.name != null ? String(req.body.name).trim() : null,
          phone: normalizedPhone,
          email: req.body.email != null ? String(req.body.email).trim() : null,
          address_1: address,
          zipCode,
          portal: req.body.portal != null ? String(req.body.portal).trim() : null,
          observations:
            req.body.observations != null ? String(req.body.observations).trim() : null,
          ...geo,
        },
      });

      return res.json(saved);
    } catch (error) {
      console.error("[CUSTOMERS POST] error:", error);
      return res.status(500).json({
        error: "internal",
        message: error?.message || "unknown",
      });
    }
  });

  router.patch("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid_id" });
    }

    try {
      const existing = await prisma.customer.findUnique({
        where: { id },
        select: { id: true, partnerId: true },
      });

      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }

      const data = {
        ...(req.body.name != null ? { name: String(req.body.name).trim() } : {}),
        ...(req.body.email != null ? { email: String(req.body.email).trim() } : {}),
        ...(req.body.address_1 != null ? { address_1: String(req.body.address_1).trim() } : {}),
        ...(req.body.zipCode != null ? { zipCode: String(req.body.zipCode).trim() || null } : {}),
        ...(req.body.portal != null ? { portal: String(req.body.portal).trim() } : {}),
        ...(req.body.observations != null
          ? { observations: String(req.body.observations).trim() }
          : {}),
      };

      if (req.body.address_1 != null && req.body.zipCode == null) {
        data.zipCode = resolveCustomerZipCode(req.body.address_1, null);
      }

      const latNum = Number(req.body.lat);
      const lngNum = Number(req.body.lng);
      if (Number.isFinite(latNum)) data.lat = latNum;
      if (Number.isFinite(lngNum)) data.lng = lngNum;

      if (req.body.phone != null) {
        const normalizedPhone = toE164ES(req.body.phone);
        const base9 = esBase9(req.body.phone);

        if (!normalizedPhone || !base9) {
          return res.status(400).json({ error: "invalid_phone" });
        }

        const hit = await findByBase9(existing.partnerId, base9);
        if (hit && hit.id !== id) {
          return res.status(409).json({ error: "phone_exists", customer: hit });
        }

        data.phone = normalizedPhone;
      }

      const updated = await prisma.customer.update({
        where: { id },
        data,
      });

      return res.json(updated);
    } catch (error) {
      console.error("[CUSTOMERS PATCH] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.patch("/:id/restrict", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid_id" });
    }

    try {
      const flag = Boolean(req.body.isRestricted);
      const reason = String(req.body.reason || "").trim();

      const updated = await prisma.customer.update({
        where: { id },
        data: {
          isRestricted: flag,
          restrictionReason: reason || null,
          restrictedAt: flag ? new Date() : null,
        },
      });

      return res.json(updated);
    } catch (error) {
      console.error("[CUSTOMERS RESTRICT] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid_id" });
    }

    try {
      await prisma.customer.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (error) {
      console.error("[CUSTOMERS DELETE] error:", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  return router;
}
