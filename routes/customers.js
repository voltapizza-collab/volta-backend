import express from "express";
import axios from "axios";

const COLD_DAYS_THRESHOLD = 15;
const postalGeocodeCache = new Map();

const getGoogleGeocodingKey = () => process.env.GOOGLE_GEOCODING_KEY;

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

const toCoordinate = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasUsableCoordinates = (lat, lng) => {
  const safeLat = toCoordinate(lat);
  const safeLng = toCoordinate(lng);
  return safeLat != null && safeLng != null && !(safeLat === 0 && safeLng === 0);
};

const getCoordinates = (source) => {
  const lat = toCoordinate(source?.lat ?? source?.latitude);
  const lng = toCoordinate(source?.lng ?? source?.longitude);
  return hasUsableCoordinates(lat, lng) ? { lat, lng } : {};
};

const normalizeCountryCode = (value) => {
  const normalized = String(value || "ES").trim().toUpperCase();
  if (!normalized || normalized === "ESPAÑA" || normalized === "ESPANA" || normalized === "SPAIN") {
    return "ES";
  }
  return normalized.length === 2 ? normalized : "ES";
};

const geocodePostalCode = async (zipCode, country = "ES") => {
  const normalizedZip = String(zipCode || "").trim();
  const googleKey = getGoogleGeocodingKey();
  if (!googleKey || !normalizedZip) return {};

  const countryCode = normalizeCountryCode(country);
  const cacheKey = `${countryCode}:${normalizedZip}`;
  if (postalGeocodeCache.has(cacheKey)) return postalGeocodeCache.get(cacheKey);

  try {
    const response = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        address: `${normalizedZip}, ${countryCode}`,
        components: `postal_code:${normalizedZip}|country:${countryCode}`,
        key: googleKey,
      },
    });

    const location = response.data?.results?.[0]?.geometry?.location;
    const coords = hasUsableCoordinates(location?.lat, location?.lng)
      ? { lat: Number(location.lat), lng: Number(location.lng) }
      : {};

    postalGeocodeCache.set(cacheKey, coords);
    return coords;
  } catch (error) {
    console.warn("[customers.territory] postal geocode failed:", normalizedZip, error?.message || error);
    postalGeocodeCache.set(cacheKey, {});
    return {};
  }
};

const readObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const resolveCouponMetaZipCode = (coupon) => {
  const meta = readObject(coupon?.meta);
  return resolveCustomerZipCode(
    "",
    meta.claimedFromZipCode || meta.targetCustomerZipCode || meta.zipCode
  );
};

const findTerritoryStore = (stores = [], zipCode) => {
  const normalizedZip = String(zipCode || "").trim();
  const area = postalAreaKey(normalizedZip);

  if (!normalizedZip && !area) return null;

  return (
    stores.find((store) => String(store?.zipCode || "").trim() === normalizedZip) ||
    stores.find((store) => area && postalAreaKey(store?.zipCode) === area) ||
    null
  );
};

const buildTerritory = ({ zipCode, source, storeId = null, coordinateSource = null }) => ({
  zipCode,
  source,
  storeId,
  ...getCoordinates(coordinateSource),
});

const resolveCustomerTerritory = (customer, stores = []) => {
  const explicitZip = String(customer?.zipCode || "").trim();
  if (explicitZip) {
    return buildTerritory({
      zipCode: explicitZip,
      source: "customer",
      coordinateSource: hasUsableCoordinates(customer?.lat, customer?.lng)
        ? customer
        : findTerritoryStore(stores, explicitZip),
    });
  }

  const addressZip = extractZipCode(customer?.address_1);
  if (addressZip) {
    return buildTerritory({
      zipCode: addressZip,
      source: "address",
      coordinateSource: hasUsableCoordinates(customer?.lat, customer?.lng)
        ? customer
        : findTerritoryStore(stores, addressZip),
    });
  }

  const latestSale = customer?.sales?.[0] || null;
  if (latestSale) {
    const saleAddressZip = extractZipCode(latestSale.address_1);
    if (saleAddressZip) {
      return buildTerritory({
        zipCode: saleAddressZip,
        source: "last_sale_address",
        storeId: latestSale.storeId || null,
        coordinateSource: hasUsableCoordinates(latestSale.lat, latestSale.lng)
          ? latestSale
          : latestSale.store || findTerritoryStore(stores, saleAddressZip),
      });
    }

    const saleStoreZip = String(latestSale.store?.zipCode || "").trim();
    if (saleStoreZip) {
      return buildTerritory({
        zipCode: saleStoreZip,
        source: "last_sale_store",
        storeId: latestSale.storeId || latestSale.store?.id || null,
        coordinateSource: latestSale.store || findTerritoryStore(stores, saleStoreZip),
      });
    }
  }

  const latestRedemption = customer?.redemptions?.[0] || null;
  if (latestRedemption) {
    const redemptionStoreZip = String(latestRedemption.store?.zipCode || "").trim();
    if (redemptionStoreZip) {
      return buildTerritory({
        zipCode: redemptionStoreZip,
        source: "last_coupon_store",
        storeId: latestRedemption.storeId || latestRedemption.store?.id || null,
        coordinateSource: latestRedemption.store || findTerritoryStore(stores, redemptionStoreZip),
      });
    }

    const redemptionCouponZip = resolveCouponMetaZipCode(latestRedemption.coupon);
    if (redemptionCouponZip) {
      return buildTerritory({
        zipCode: redemptionCouponZip,
        source: "last_coupon",
        storeId: latestRedemption.storeId || null,
        coordinateSource: findTerritoryStore(stores, redemptionCouponZip),
      });
    }
  }

  const assignedCouponZip = resolveCouponMetaZipCode(customer?.assignedCoupons?.[0]);
  if (assignedCouponZip) {
    return buildTerritory({
      zipCode: assignedCouponZip,
      source: "assigned_coupon",
      coordinateSource: findTerritoryStore(stores, assignedCouponZip),
    });
  }

  return { zipCode: null, source: null };
};

const serializeCustomerWithTerritory = (customer, stores = []) => {
  const territory = resolveCustomerTerritory(customer, stores);
  const { sales, redemptions, assignedCoupons, ...rest } = customer;

  return {
    ...rest,
    zipCode: rest.zipCode || territory.zipCode,
    lat: hasUsableCoordinates(rest.lat, rest.lng) ? rest.lat : territory.lat ?? rest.lat,
    lng: hasUsableCoordinates(rest.lat, rest.lng) ? rest.lng : territory.lng ?? rest.lng,
    territoryZipCode: territory.zipCode,
    territorySource: territory.source,
    territoryStoreId: territory.storeId || null,
    territoryLat: territory.lat ?? null,
    territoryLng: territory.lng ?? null,
  };
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

const daysBetween = (left, right = new Date()) => {
  if (!left) return null;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return null;
  return Math.max(0, Math.floor((rightDate.getTime() - leftDate.getTime()) / 86400000));
};

const getCustomerTrend = ({ orders, avgTicket, lastTicket }) => {
  if (!orders) return "Sin compras";
  if (orders === 1) return "Inicial";
  if (lastTicket >= avgTicket * 1.15) return "En alza";
  if (lastTicket < avgTicket * 0.85) return "Bajando";
  return "Estable";
};

const getCustomerSegment = ({ orders, daysOff, avgTicket, lastTicket }) => {
  if (orders === 0) return "S1";
  if (orders === 1) return "S2";
  if (orders >= 10) return "S5";
  if (Number(daysOff || 0) > 30) return "S3";
  if (lastTicket >= avgTicket * 1.15) return "S5";
  return "S4";
};

const summarizeCustomerSales = (sales = [], now = new Date()) => {
  const rows = sales
    .map((row) => ({
      total: Number(row.total || 0),
      createdAt: row.createdAt,
    }))
    .filter((row) => Number.isFinite(row.total) && row.total > 0)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const orders = rows.length;
  const sum = rows.reduce((acc, row) => acc + row.total, 0);
  const avgTicket = orders ? sum / orders : 0;
  const lastTicket = rows[0]?.total || 0;
  const daysOff = orders ? daysBetween(rows[0]?.createdAt, now) ?? 0 : null;

  return {
    orderCount: orders,
    averageTicket: avgTicket,
    lastTicket,
    daysOff,
    trend: getCustomerTrend({ orders, avgTicket, lastTicket }),
    segment: getCustomerSegment({ orders, daysOff, avgTicket, lastTicket }),
  };
};

const buildStoreScopeFilters = (storeId, selectedStore) => {
  const storeZip = String(selectedStore?.zipCode || "").trim();
  const storeArea = postalAreaKey(storeZip);
  const storeCity = String(selectedStore?.city || "").trim();

  return [
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
      ? [{ address_1: { contains: storeCity } }]
      : []),
  ];
};

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

    andFilters.push({
      OR: buildStoreScopeFilters(storeId, selectedStore),
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

      const [list, territoryStores, partnerTerritory] = await Promise.all([
        prisma.customer.findMany({
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
            sales: {
              orderBy: { date: "desc" },
              take: 1,
              select: {
                storeId: true,
                address_1: true,
                lat: true,
                lng: true,
                date: true,
                store: {
                  select: {
                    id: true,
                    storeName: true,
                    zipCode: true,
                    latitude: true,
                    longitude: true,
                  },
                },
              },
            },
            redemptions: {
              orderBy: { redeemedAt: "desc" },
              take: 1,
              select: {
                storeId: true,
                redeemedAt: true,
                store: {
                  select: {
                    id: true,
                    storeName: true,
                    zipCode: true,
                    latitude: true,
                    longitude: true,
                  },
                },
                coupon: {
                  select: {
                    meta: true,
                  },
                },
              },
            },
            assignedCoupons: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                meta: true,
                createdAt: true,
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        }),
        partnerId
          ? prisma.store.findMany({
              where: { partnerId },
              select: {
                id: true,
                storeName: true,
                city: true,
                zipCode: true,
                latitude: true,
                longitude: true,
              },
            })
          : Promise.resolve([]),
        partnerId
          ? prisma.partner.findUnique({
              where: { id: partnerId },
              select: { country: true },
            })
          : Promise.resolve(null),
      ]);

      const serialized = await Promise.all(
        list.map(async (customer) => {
          const row = serializeCustomerWithTerritory(customer, territoryStores);
          if (hasUsableCoordinates(row.lat, row.lng) || !row.territoryZipCode) return row;

          const coords = await geocodePostalCode(row.territoryZipCode, partnerTerritory?.country || "ES");
          if (!hasUsableCoordinates(coords.lat, coords.lng)) return row;

          return {
            ...row,
            lat: coords.lat,
            lng: coords.lng,
            territoryLat: coords.lat,
            territoryLng: coords.lng,
            territorySource: row.territorySource ? `${row.territorySource}_postal_geocode` : "postal_geocode",
          };
        })
      );

      return res.json(serialized);
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

    if (query) {
      const queryFilters = [
        { code: { contains: query } },
        { name: { contains: query } },
        { phone: { contains: query } },
        { email: { contains: query } },
        { address_1: { contains: query } },
        { zipCode: { contains: query } },
        { portal: { contains: query } },
        { observations: { contains: query } },
      ];

      if (digits) {
        queryFilters.push(
          { phone: { contains: digits } },
          { zipCode: { contains: digits } },
          { address_1: { contains: digits } }
        );
      }

      andFilters.push({
        OR: queryFilters,
      });
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

        andFilters.push({
          OR: buildStoreScopeFilters(storeId, selectedStore),
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
            activity: true,
            sales: {
              select: {
                total: true,
                createdAt: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
          skip,
          take,
        }),
        prisma.customer.count({ where }),
      ]);

      return res.json({
        items: items.map((customer) => {
          const { sales, ...rest } = customer;
          return {
            ...rest,
            ...summarizeCustomerSales(sales),
          };
        }),
        total,
        skip,
        take,
      });
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
      const [bySeg, total, restricted, cold, zipRows, territoryStores] = await Promise.all([
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
            sales: {
              orderBy: { date: "desc" },
              take: 1,
              select: {
                storeId: true,
                address_1: true,
                lat: true,
                lng: true,
                store: {
                  select: {
                    id: true,
                    zipCode: true,
                    latitude: true,
                    longitude: true,
                  },
                },
              },
            },
            redemptions: {
              orderBy: { redeemedAt: "desc" },
              take: 1,
              select: {
                storeId: true,
                store: {
                  select: {
                    id: true,
                    zipCode: true,
                    latitude: true,
                    longitude: true,
                  },
                },
                coupon: {
                  select: {
                    meta: true,
                  },
                },
              },
            },
            assignedCoupons: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                meta: true,
              },
            },
          },
        }),
        prisma.store.findMany({
          where: { partnerId },
          select: {
            id: true,
            zipCode: true,
            latitude: true,
            longitude: true,
          },
        }),
      ]);

      const counts = { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };
      const zipCodes = [...new Set(
        zipRows
          .map((row) => resolveCustomerTerritory(row, territoryStores).zipCode)
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
      const customers = await prisma.customer.findMany({
        where: { partnerId },
        select: {
          id: true,
          segment: true,
          daysOff: true,
          activity: true,
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
      const now = new Date();

      customers.forEach((customer) => {
        const summary = summarizeCustomerSales(customer.sales, now);
        const segment = summary.segment;
        const daysOff = summary.daysOff ?? customer.daysOff ?? null;

        counts[segment] += 1;
        const activity = getCustomerActivity(daysOff);

        if (segment !== customer.segment || activity !== customer.activity || daysOff !== customer.daysOff) {
          changed += 1;
        }

        updates.push(
          prisma.customer.update({
            where: { id: customer.id },
            data: {
              segment,
              activity,
              daysOff,
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

      const googleKey = getGoogleGeocodingKey();
      if (!isPickup && (!geo.lat || !geo.lng) && googleKey) {
        try {
          const response = await axios.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            {
              params: {
                address,
                components: "country:ES",
                key: googleKey,
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
