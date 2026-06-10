import express from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { assertCloudinaryConfigured } from "../services/cloudinaryConfig.js";
import {
  ensureBackofficeDemoSession,
  isBackofficeDemoCredential,
} from "../services/backofficeDemoSession.js";
import {
  SMS_NOTIFICATION_SERVICE_IDS,
  normalizeSmsNotificationSettings,
} from "../services/smsNotificationSettings.js";

const prisma = new PrismaClient();
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const STOREFRONT_BUTTON_IDS = [
  "selectProducts",
  "coupons",
  "halfAndHalf",
  "customPizza",
  "scheduleOrder",
  "repeatOrder",
  "call",
  "reservations",
  "payNow",
  "couponCode",
  "boost",
];

const TRACKING_NOTIFICATION_SERVICE_IDS = SMS_NOTIFICATION_SERVICE_IDS;

const PRICE_ADJUSTMENT_TARGET_TYPES = ["ALL", "CATEGORY", "PRODUCT"];
const PRICE_ADJUSTMENT_STATUSES = ["ACTIVE", "PAUSED"];

const isPrismaConnectionClosed = (error) =>
  error?.code === "P1017" ||
  String(error?.message || "").includes("Server has closed the connection");

prisma.$use(async (params, next) => {
  try {
    return await next(params);
  } catch (error) {
    if (!isPrismaConnectionClosed(error)) {
      throw error;
    }

    console.warn("[partners.prisma] connection closed; reconnecting and retrying once");
    await prisma.$disconnect().catch(() => {});
    await prisma.$connect();
    return next(params);
  }
});

const GOOGLE_GEOCODING_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";
const GOOGLE_ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const COVERAGE_ROUTE_ESTIMATE_FACTOR = Number(
  process.env.COVERAGE_ROUTE_ESTIMATE_FACTOR || 1.3
);

const getGoogleGeocodingKey = () =>
  process.env.GOOGLE_GEOCODING_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.REACT_APP_GOOGLE_KEY ||
  "";

const storeTimeZone = () => process.env.TIMEZONE || "Europe/Madrid";

const getStoreClockNow = () => {
  const zoned = new Date().toLocaleString("sv-SE", {
    timeZone: storeTimeZone(),
  });

  return new Date(zoned.replace(" ", "T"));
};

const parseStoreMinute = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);

  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

const isStoreOpenNow = (store, now = new Date()) => {
  const hours = Array.isArray(store?.hours) ? store.hours : [];
  if (!hours.length) return true;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayDay = today.getDay();

  for (let offset = -1; offset <= 0; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const dayOfWeek = ((todayDay + offset) % 7 + 7) % 7;
    const windows = hours.filter((item) => Number(item.dayOfWeek) === dayOfWeek);

    for (const window of windows) {
      const openMinute = parseStoreMinute(window.openTime);
      const closeMinute = parseStoreMinute(window.closeTime);
      if (openMinute == null || closeMinute == null) continue;

      const openAt = new Date(date);
      openAt.setMinutes(openMinute, 0, 0);

      const closeAt = new Date(date);
      closeAt.setMinutes(closeMinute, 0, 0);
      if (closeMinute <= openMinute) closeAt.setDate(closeAt.getDate() + 1);

      if (now >= openAt && now < closeAt) return true;
    }
  }

  return false;
};

const filterOperationalStores = (stores = [], now = getStoreClockNow()) =>
  stores.filter(
    (store) => store?.active !== false && store?.acceptingOrders !== false && isStoreOpenNow(store, now)
  );

export const selectDeliveryCoverageStores = (stores = [], now = getStoreClockNow()) => {
  const activeStores = stores.filter(
    (store) => store?.active !== false && store?.acceptingOrders !== false
  );
  const operationalStores = filterOperationalStores(activeStores, now);

  return operationalStores.length ? operationalStores : activeStores;
};

async function ensurePartnerSettingsColumns() {
  const columns = [
    ["deliveryRadiusKm", "DOUBLE NULL"],
    ["deliveryPricingMode", "ENUM('FIXED','VARIABLE') NOT NULL DEFAULT 'FIXED'"],
    ["deliveryFeeBlockSize", "INT NULL DEFAULT 5"],
    ["deliveryMaxPizzasPerOrder", "INT NULL"],
    ["deliveryFeeFixed", "DOUBLE NULL"],
    ["deliveryFeeBase", "DOUBLE NULL"],
    ["deliveryBaseKm", "DOUBLE NULL"],
    ["deliveryExtraPerKm", "DOUBLE NULL"],
    ["brandPrimary", "VARCHAR(32) NULL"],
    ["brandSecondary", "VARCHAR(32) NULL"],
    ["brandAccent", "VARCHAR(32) NULL"],
    ["brandSurface", "VARCHAR(32) NULL"],
    ["brandTextColor", "VARCHAR(32) NULL"],
    ["brandFontFamily", "VARCHAR(64) NULL"],
    ["brandOfferButtonStyle", "VARCHAR(64) NULL"],
    ["brandLogoUrl", "TEXT NULL"],
    ["brandLogoPublicId", "VARCHAR(255) NULL"],
    ["minimumPaymentAmount", "DOUBLE NULL DEFAULT 0"],
    ["storefrontButtonConfig", "JSON NULL"],
    ["storefrontMode", "VARCHAR(64) NULL"],
    ["trackingNotificationSettings", "JSON NULL"],
    ["priceAdjustmentRules", "JSON NULL"],
    ["paymentPolicySettings", "JSON NULL"],
  ];

  let existingColumns = new Set();

  try {
    const rows = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM `Partner`");
    existingColumns = new Set(
      (rows || []).map((row) => String(row.Field || row.field || "").trim())
    );
  } catch (error) {
    if (isPrismaConnectionClosed(error)) {
      throw error;
    }

    console.warn(
      "PARTNER COLUMN INTROSPECTION ERROR:",
      error?.message || error
    );
  }

  for (const [columnName, definition] of columns) {
    if (existingColumns.has(columnName)) continue;

    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`Partner\` ADD COLUMN \`${columnName}\` ${definition}`
      );
    } catch (error) {
      const message = String(error?.message || error);
      const metaMessage = String(error?.meta?.message || "");
      if (!message.includes("Duplicate column name") && !metaMessage.includes("Duplicate column name")) {
        throw error;
      }
    }
  }
}

async function getPartnerPolicyById(partnerId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, slug, country, currency, active, createdAt, updatedAt,
            deliveryRadiusKm, deliveryPricingMode, deliveryFeeBlockSize,
            deliveryMaxPizzasPerOrder, deliveryFeeFixed, deliveryFeeBase,
            deliveryBaseKm, deliveryExtraPerKm, brandPrimary, brandSecondary,
            brandAccent, brandSurface, brandTextColor, brandFontFamily, brandOfferButtonStyle,
            brandLogoUrl, brandLogoPublicId, minimumPaymentAmount, storefrontButtonConfig,
            storefrontMode, trackingNotificationSettings, priceAdjustmentRules, paymentPolicySettings
       FROM Partner
      WHERE id = ?`,
    partnerId
  );

  return rows?.[0] || null;
}

async function getPartnerPolicyBySlug(slug) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, slug, country, currency, active, createdAt, updatedAt,
            deliveryRadiusKm, deliveryPricingMode, deliveryFeeBlockSize,
            deliveryMaxPizzasPerOrder, deliveryFeeFixed, deliveryFeeBase,
            deliveryBaseKm, deliveryExtraPerKm, brandPrimary, brandSecondary,
            brandAccent, brandSurface, brandTextColor, brandFontFamily, brandOfferButtonStyle,
            brandLogoUrl, brandLogoPublicId, minimumPaymentAmount, storefrontButtonConfig,
            storefrontMode, trackingNotificationSettings, priceAdjustmentRules, paymentPolicySettings
       FROM Partner
      WHERE slug = ?`,
    slug
  );

  return rows?.[0] || null;
}

async function geocodeAddress(address, region, key) {
  const response = await axios.get(GOOGLE_GEOCODING_URL, {
    params: {
      address,
      region,
      key,
    },
  });

  const result = response.data?.results?.[0];

  if (!result?.geometry?.location) {
    return null;
  }

  return {
    formattedAddress: result.formatted_address,
    lat: Number(result.geometry.location.lat),
    lng: Number(result.geometry.location.lng),
    locationType: result.geometry.location_type,
    partialMatch: Boolean(result.partial_match),
    types: Array.isArray(result.types) ? result.types : [],
  };
}

async function geocodeCustomerAddress(address, partner, stores, key) {
  const directMatch = await geocodeAddress(address, partner.country || "ES", key);
  if (directMatch) return directMatch;

  const fallbackCity = stores.find((store) => store?.city)?.city;
  const enrichedAddress = [address, fallbackCity, partner.country]
    .filter(Boolean)
    .join(", ");

  if (enrichedAddress !== address) {
    return geocodeAddress(enrichedAddress, partner.country || "ES", key);
  }

  return null;
}

async function computeDrivingDistances(origin, stores, key) {
  if (!key || !origin?.lat || !origin?.lng || !stores.length) return null;

  try {
    const response = await axios.post(
      GOOGLE_ROUTE_MATRIX_URL,
      {
        origins: [
          {
            waypoint: {
              location: {
                latLng: {
                  latitude: origin.lat,
                  longitude: origin.lng,
                },
              },
            },
          },
        ],
        destinations: stores.map((store) => ({
          waypoint: {
            location: {
              latLng: {
                latitude: store.latitude,
                longitude: store.longitude,
              },
            },
          },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "originIndex,destinationIndex,duration,distanceMeters,status,condition",
        },
      }
    );

    const rows = Array.isArray(response.data) ? response.data : [];
    const distancesByIndex = new Map();

    rows.forEach((row) => {
      const destinationIndex = Number(row?.destinationIndex);
      const distanceMeters = Number(row?.distanceMeters);
      const isRoutable =
        row?.condition === "ROUTE_EXISTS" ||
        row?.status?.code === 0 ||
        !row?.status;

      if (
        Number.isInteger(destinationIndex) &&
        Number.isFinite(distanceMeters) &&
        distanceMeters >= 0 &&
        isRoutable
      ) {
        distancesByIndex.set(destinationIndex, {
          distanceKm: distanceMeters / 1000,
          duration: row?.duration || null,
        });
      }
    });

    if (!distancesByIndex.size) return null;

    return stores
      .map((store, index) => {
        const match = distancesByIndex.get(index);
        if (!match) return null;
        return {
          ...store,
          distanciaKm: match.distanceKm,
          routeDuration: match.duration,
          distanceSource: "DRIVING_ROUTE",
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn(
      "GOOGLE ROUTE MATRIX ERROR:",
      error?.response?.data || error?.message || error
    );
    return null;
  }
}

export function buildManualDeliveryResolution({ address, partner, stores, reason }) {
  const fallbackStore = stores[0] || null;
  const radiusKm =
    partner.deliveryRadiusKm == null ? null : Number(partner.deliveryRadiusKm);
  const withinRange = Boolean(fallbackStore);

  return {
    formattedAddress: address,
    coords: null,
    withinRange,
    deliveryRadiusKm: radiusKm,
    deliveryFee:
      withinRange && fallbackStore
        ? computeDeliveryFee(partner, 0)
        : null,
    deliveryFeeBlockSize: Number(partner.deliveryFeeBlockSize || 5),
    deliveryMaxPizzasPerOrder: toPositiveIntegerOrNull(
      partner.deliveryMaxPizzasPerOrder
    ),
    pricingMode: partner.deliveryPricingMode,
    geocodingStatus: "MANUAL_FALLBACK",
    geocodingReason: reason,
    coverageDistanceRequired: radiusKm == null ? null : "MANUAL_REVIEW",
    coverageDistanceAvailable: radiusKm == null,
    nearestStore: fallbackStore
      ? {
          id: fallbackStore.id,
          slug: fallbackStore.slug,
          storeName: fallbackStore.storeName,
          city: fallbackStore.city,
          distanceKm: null,
          distanceSource: "MANUAL_FALLBACK",
        }
      : null,
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

export function isPreciseCustomerGeocode(geocode) {
  if (!geocode) return false;
  if (geocode.source === "PLACE_AUTOCOMPLETE") return true;

  const preciseTypes = new Set([
    "street_address",
    "premise",
    "subpremise",
    "establishment",
    "point_of_interest",
  ]);

  return (
    geocode.partialMatch !== true &&
    (geocode.types || []).some((type) => preciseTypes.has(type))
  );
}

export function computeDeliveryFee(partner, distanceKm) {
  if (partner.deliveryPricingMode === "VARIABLE") {
    const base = Number(partner.deliveryFeeBase || 0);
    const baseKm = Number(partner.deliveryBaseKm || 0);
    const extraPerKm = Number(partner.deliveryExtraPerKm || 0);
    const extraDistance = Math.max(0, distanceKm - baseKm);
    const extraBlocks = Math.ceil(extraDistance);
    return Number((base + extraBlocks * extraPerKm).toFixed(2));
  }

  return Number((partner.deliveryFeeFixed || 0).toFixed(2));
}

const toNumberOrNull = (value) => {
  if (value === "" || value == null) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const normalizeRequestCoords = (value) => {
  const lat = toNumberOrNull(value?.lat);
  const lng = toNumberOrNull(value?.lng);

  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
};

const toNonNegativeNumber = (value, fallback = 0) => {
  if (value === "" || value == null) return fallback;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const parseMaybeJson = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizePaymentPolicySettings = (value) => {
  const parsed = parseMaybeJson(parseMaybeJson(value, {}), {});
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};

  return {
    schemaVersion: 1,
    card: true,
    cash: Boolean(source.cash),
    cashStoreIds: normalizePositiveIds(source.cashStoreIds),
    paypal: Boolean(source.paypal),
    paypalStoreIds: normalizePositiveIds(source.paypalStoreIds),
    crypto: Boolean(source.crypto),
    cryptoStoreIds: normalizePositiveIds(source.cryptoStoreIds),
  };
};

const normalizePositiveIds = (value) => {
  const parsed = parseMaybeJson(value, value);
  const list = Array.isArray(parsed) ? parsed : parsed == null || parsed === "" ? [] : [parsed];

  return [
    ...new Set(
      list
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    ),
  ];
};

const normalizeDaysActive = (value) => {
  const parsed = parseMaybeJson(value, value);
  const list = Array.isArray(parsed) ? parsed : parsed == null || parsed === "" ? [] : [parsed];

  return [
    ...new Set(
      list
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
    ),
  ].sort();
};

const normalizeNullableDate = (value) => {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeNullableMinute = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 24 * 60 ? parsed : null;
};

const normalizeAdjustmentPercent = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < -100 || parsed > 100) return null;
  return roundMoney(parsed);
};

const normalizePriceAdjustmentRule = (source = {}, index = 0) => {
  const value = normalizeAdjustmentPercent(source.value);
  if (value == null) return null;

  const targetType = PRICE_ADJUSTMENT_TARGET_TYPES.includes(
    String(source.targetType || "").toUpperCase()
  )
    ? String(source.targetType).toUpperCase()
    : "ALL";
  const categoryIds = normalizePositiveIds(source.categoryIds);
  const productIds = normalizePositiveIds(source.productIds);
  const storeIds = normalizePositiveIds(source.storeIds);
  const status = PRICE_ADJUSTMENT_STATUSES.includes(
    String(source.status || "").toUpperCase()
  )
    ? String(source.status).toUpperCase()
    : "ACTIVE";
  const id = String(source.id || "").trim() || `price-rule-${Date.now()}-${index}`;
  const title =
    String(source.title || "").trim() ||
    `${value > 0 ? "Subida" : "Bajada"} ${Math.abs(value)}%`;

  if (targetType === "CATEGORY" && !categoryIds.length) return null;
  if (targetType === "PRODUCT" && !productIds.length) return null;

  return {
    id,
    title,
    type: "PERCENT",
    value,
    targetType,
    categoryIds,
    productIds,
    storeIds,
    activeFrom: normalizeNullableDate(source.activeFrom),
    expiresAt: normalizeNullableDate(source.expiresAt),
    daysActive: normalizeDaysActive(source.daysActive),
    windowStart: normalizeNullableMinute(source.windowStart),
    windowEnd: normalizeNullableMinute(source.windowEnd),
    status,
  };
};

const normalizePriceAdjustmentRules = (value) => {
  const parsed = parseMaybeJson(value, []);
  const list = Array.isArray(parsed) ? parsed : [];

  return list
    .map((rule, index) => normalizePriceAdjustmentRule(rule, index))
    .filter(Boolean);
};

const buildPriceAdjustmentWhere = (partnerId, adjustment) => {
  const where = {
    partnerId,
    type: "SELLABLE",
  };

  if (adjustment.targetType === "CATEGORY") {
    where.categoryId = { in: adjustment.categoryIds };
  }

  if (adjustment.targetType === "PRODUCT") {
    where.id = { in: adjustment.productIds };
  }

  return where;
};

const applyPercentToPriceBySize = (priceBySize, percent) => {
  const source =
    priceBySize && typeof priceBySize === "object" && !Array.isArray(priceBySize)
      ? priceBySize
      : {};
  const multiplier = 1 + percent / 100;

  return Object.fromEntries(
    Object.entries(source).map(([size, price]) => {
      const numericPrice = Number(price);
      if (!Number.isFinite(numericPrice) || numericPrice <= 0) return [size, price];

      return [size, roundMoney(Math.max(0, numericPrice * multiplier))];
    })
  );
};

const normalizeStorefrontButtonConfig = (value) => {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return STOREFRONT_BUTTON_IDS.reduce((config, buttonId) => {
    config[buttonId] = source[buttonId] == null ? true : Boolean(source[buttonId]);
    return config;
  }, {});
};

const normalizeTrackingNotificationSettings = normalizeSmsNotificationSettings;

const toPositiveIntegerOrNull = (value) => {
  if (value === "" || value == null) return null;
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) return null;
  return numericValue;
};

const normalizeHexColor = (value, fallback = null) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return fallback;
  return /^#[0-9A-F]{6}$/.test(raw) ? raw : fallback;
};

async function uploadPartnerLogo(file, partnerId) {
  if (!file) {
    const error = new Error("Logo file required");
    error.status = 400;
    throw error;
  }

  assertCloudinaryConfigured();

  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    { folder: `volta/partners/${partnerId}/branding` }
  );

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
}

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

router.post("/backoffice-demo-session", async (req, res) => {
  try {
    if (!isBackofficeDemoCredential(req.body || {})) {
      return res.status(401).json({ error: "Credenciales invalidas." });
    }

    const session = await ensureBackofficeDemoSession(prisma);
    return res.json(session);
  } catch (error) {
    console.error("[backoffice-demo-session]", error);
    return res.status(500).json({ error: "No se pudo preparar la sesion demo." });
  }
});

router.post("/:slug/delivery/resolve", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const address = String(req.body?.address || "").trim();

    if (!address) {
      return res.status(400).json({ error: "Address required" });
    }

    const googleKey = getGoogleGeocodingKey();

    const partner = await getPartnerPolicyBySlug(req.params.slug);

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    const rawStores = await prisma.store.findMany({
      where: {
        partnerId: Number(partner.id),
        active: true,
        acceptingOrders: true,
      },
      include: {
        hours: {
          orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
        },
      },
      orderBy: { storeName: "asc" },
    });
    const stores = selectDeliveryCoverageStores(rawStores);

    if (!googleKey) {
      return res.json(
        buildManualDeliveryResolution({
          address,
          partner,
          stores,
          reason: "GOOGLE_GEOCODING_KEY not configured",
        })
      );
    }

    const requestCoords = normalizeRequestCoords(req.body?.coords);
    const customerGeocode = requestCoords
      ? {
          formattedAddress: String(req.body?.formattedAddress || address).trim() || address,
          lat: requestCoords.lat,
          lng: requestCoords.lng,
          source: "PLACE_AUTOCOMPLETE",
        }
      : await geocodeCustomerAddress(
          address,
          partner,
          stores,
          googleKey
        );

    if (!customerGeocode) {
      return res.json(
        buildManualDeliveryResolution({
          address,
          partner,
          stores,
          reason: "ADDRESS_NOT_FOUND",
        })
      );
    }

    const lat = Number(customerGeocode.lat);
    const lng = Number(customerGeocode.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.json(
        buildManualDeliveryResolution({
          address,
          partner,
          stores,
          reason: "ADDRESS_COORDS_UNAVAILABLE",
        })
      );
    }

    const preciseCustomerGeocode = isPreciseCustomerGeocode(customerGeocode);

    const storesWithResolvedCoords = await Promise.all(
      stores.map(async (store) => {
        if (
          typeof store.latitude === "number" &&
          typeof store.longitude === "number"
        ) {
          return store;
        }

        const storeAddress = [store.address, store.city, partner.country]
          .filter(Boolean)
          .join(", ");

        if (!storeAddress) return store;

        const storeGeocode = await geocodeAddress(
          storeAddress,
          partner.country || "ES",
          googleKey
        );

        if (!storeGeocode) return store;

        try {
          await prisma.store.update({
            where: { id: store.id },
            data: {
              latitude: storeGeocode.lat,
              longitude: storeGeocode.lng,
            },
          });
        } catch (updateError) {
          console.error(
            "STORE COORDS CACHE ERROR:",
            updateError?.message || updateError
          );
        }

        return {
          ...store,
          latitude: storeGeocode.lat,
          longitude: storeGeocode.lng,
        };
      })
    );

    const eligibleStores = storesWithResolvedCoords.filter(
      (store) =>
        typeof store.latitude === "number" && typeof store.longitude === "number"
    );

    if (!eligibleStores.length) {
      return res.json(
        buildManualDeliveryResolution({
          address,
          partner,
          stores,
          reason: "NO_STORES_WITH_COORDS",
        })
      );
    }

    const fallbackDistances = eligibleStores
      .map((store) => ({
        ...store,
        straightLineDistanceKm: haversineKm(lat, lng, store.latitude, store.longitude),
        routeDuration: null,
        distanceSource: "HAVERSINE_ROUTE_ESTIMATE",
      }))
      .map((store) => ({
        ...store,
        distanciaKm: store.straightLineDistanceKm * COVERAGE_ROUTE_ESTIMATE_FACTOR,
      }))
      .sort((a, b) => a.distanciaKm - b.distanciaKm);

    const drivingDistances = await computeDrivingDistances(
      { lat, lng },
      eligibleStores,
      googleKey
    );

    const hasDrivingDistances = Boolean(drivingDistances?.length);
    const distanceRows = (hasDrivingDistances ? drivingDistances : fallbackDistances)
      .slice()
      .sort((a, b) => a.distanciaKm - b.distanciaKm);
    const nearestStore = distanceRows[0];

    const radiusKm =
      partner.deliveryRadiusKm == null
        ? null
        : Number(partner.deliveryRadiusKm);
    const withinRange =
      radiusKm == null ? true : nearestStore.distanciaKm <= radiusKm;
    const deliveryFee = withinRange
      ? computeDeliveryFee(partner, nearestStore.distanciaKm)
      : null;

    return res.json({
      formattedAddress: customerGeocode.formattedAddress,
      coords: { lat, lng },
      withinRange,
      deliveryRadiusKm: radiusKm,
      deliveryFee,
      deliveryFeeBlockSize: Number(partner.deliveryFeeBlockSize || 5),
      deliveryMaxPizzasPerOrder: toPositiveIntegerOrNull(
        partner.deliveryMaxPizzasPerOrder
      ),
      pricingMode: partner.deliveryPricingMode,
      geocodingStatus: preciseCustomerGeocode ? "GEOCODED" : "GEOCODED_APPROXIMATE",
      geocodingReason: preciseCustomerGeocode ? null : "ADDRESS_NOT_PRECISE",
      coverageDistanceRequired: radiusKm == null ? null : "DRIVING_ROUTE_OR_ESTIMATE",
      coverageDistanceAvailable: true,
      nearestStore: {
        id: nearestStore.id,
        slug: nearestStore.slug,
        storeName: nearestStore.storeName,
        city: nearestStore.city,
        distanceKm: Number(nearestStore.distanciaKm.toFixed(2)),
        straightLineDistanceKm:
          nearestStore.straightLineDistanceKm == null
            ? null
            : Number(nearestStore.straightLineDistanceKm.toFixed(2)),
        routeEstimateFactor:
          nearestStore.distanceSource === "HAVERSINE_ROUTE_ESTIMATE"
            ? COVERAGE_ROUTE_ESTIMATE_FACTOR
            : null,
        distanceSource: nearestStore.distanceSource,
        routeDuration: nearestStore.routeDuration,
      },
    });
  } catch (e) {
    console.error("DELIVERY RESOLVE ERROR:", e?.response?.data || e);
    try {
      await ensurePartnerSettingsColumns();
      const address = String(req.body?.address || "").trim();
      const partner = await getPartnerPolicyBySlug(req.params.slug);
      const rawStores = partner
        ? await prisma.store.findMany({
            where: {
              partnerId: Number(partner.id),
              active: true,
              acceptingOrders: true,
            },
            include: {
              hours: {
                orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
              },
            },
            orderBy: { storeName: "asc" },
          })
        : [];
      const stores = selectDeliveryCoverageStores(rawStores);

      if (partner && address) {
        return res.json(
          buildManualDeliveryResolution({
            address,
            partner,
            stores,
            reason: "DELIVERY_RESOLVE_FAILED",
          })
        );
      }
    } catch (fallbackError) {
      console.error("DELIVERY FALLBACK ERROR:", fallbackError?.message || fallbackError);
    }

    res.status(500).json({
      error: "DELIVERY_RESOLVE_FAILED",
      message: "No pudimos resolver esta direccion ahora mismo.",
    });
  }
});

router.get("/:slug", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partner = await getPartnerPolicyBySlug(req.params.slug);

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    const stores = await prisma.store.findMany({
      where: {
        partnerId: Number(partner.id),
        active: true,
      },
      include: {
        hours: {
          orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
        },
      },
      orderBy: { storeName: "asc" },
    });

    res.json({
      ...partner,
      stores,
    });
  } catch (e) {
    console.error("GET PARTNER BY SLUG ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/by-id/:partnerId", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const partner = await getPartnerPolicyById(partnerId);

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    res.json(partner);
  } catch (e) {
    console.error("GET PARTNER BY ID ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.patch("/by-id/:partnerId", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const {
      deliveryRadiusKm,
      deliveryPricingMode,
      deliveryFeeBlockSize,
      deliveryMaxPizzasPerOrder,
      deliveryFeeFixed,
      deliveryFeeBase,
      deliveryBaseKm,
      deliveryExtraPerKm,
      brandPrimary,
      brandSecondary,
      brandAccent,
      brandSurface,
      brandTextColor,
      brandFontFamily,
      brandOfferButtonStyle,
      storefrontMode,
    } = req.body;

    const normalizedPricingMode =
      deliveryPricingMode === "VARIABLE" ? "VARIABLE" : "FIXED";

    await prisma.$executeRawUnsafe(
      `UPDATE Partner
          SET deliveryRadiusKm = ?,
              deliveryPricingMode = ?,
              deliveryFeeBlockSize = ?,
              deliveryMaxPizzasPerOrder = ?,
              deliveryFeeFixed = ?,
              deliveryFeeBase = ?,
              deliveryBaseKm = ?,
              deliveryExtraPerKm = ?,
              brandPrimary = COALESCE(?, brandPrimary),
              brandSecondary = COALESCE(?, brandSecondary),
              brandAccent = COALESCE(?, brandAccent),
              brandSurface = COALESCE(?, brandSurface),
              brandTextColor = COALESCE(?, brandTextColor),
              brandFontFamily = COALESCE(?, brandFontFamily),
              brandOfferButtonStyle = COALESCE(?, brandOfferButtonStyle),
              storefrontMode = COALESCE(?, storefrontMode)
        WHERE id = ?`,
      toNumberOrNull(deliveryRadiusKm),
      normalizedPricingMode,
      (() => {
        const value = Number(deliveryFeeBlockSize || 5);
        return Number.isInteger(value) && value > 0 ? value : 5;
      })(),
      toPositiveIntegerOrNull(deliveryMaxPizzasPerOrder),
      normalizedPricingMode === "FIXED"
        ? toNumberOrNull(deliveryFeeFixed)
        : null,
      normalizedPricingMode === "VARIABLE"
        ? toNumberOrNull(deliveryFeeBase)
        : null,
      normalizedPricingMode === "VARIABLE"
        ? toNumberOrNull(deliveryBaseKm)
        : null,
      normalizedPricingMode === "VARIABLE"
        ? toNumberOrNull(deliveryExtraPerKm)
        : null,
      normalizeHexColor(brandPrimary),
      normalizeHexColor(brandSecondary),
      normalizeHexColor(brandAccent),
      normalizeHexColor(brandSurface),
      normalizeHexColor(brandTextColor),
      String(brandFontFamily || "").trim() || null,
      String(brandOfferButtonStyle || "").trim() || null,
      String(storefrontMode || "").trim() || null,
      partnerId
    );

    const partner = await getPartnerPolicyById(partnerId);

    res.json(partner);
  } catch (e) {
    console.error("UPDATE PARTNER DELIVERY POLICY ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.patch("/by-id/:partnerId/policies", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE Partner
          SET minimumPaymentAmount = ?,
              paymentPolicySettings = CAST(? AS JSON)
        WHERE id = ?`,
      toNonNegativeNumber(req.body?.minimumPaymentAmount, 0),
      JSON.stringify(normalizePaymentPolicySettings(req.body?.paymentPolicySettings)),
      partnerId
    );

    const partner = await getPartnerPolicyById(partnerId);
    res.json(partner);
  } catch (e) {
    console.error("UPDATE PARTNER POLICIES ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/by-id/:partnerId/price-adjustments", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const rows = await prisma.$queryRawUnsafe(
      `SELECT priceAdjustmentRules FROM Partner WHERE id = ?`,
      partnerId
    );

    if (!rows?.length) {
      return res.status(404).json({ error: "Partner not found" });
    }

    return res.json({
      ok: true,
      rules: normalizePriceAdjustmentRules(rows[0].priceAdjustmentRules),
    });
  } catch (e) {
    console.error("GET PARTNER PRICE ADJUSTMENTS ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.put("/by-id/:partnerId/price-adjustments", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const partner = await getPartnerPolicyById(partnerId);

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    const rules = normalizePriceAdjustmentRules(req.body?.rules);

    await prisma.$executeRawUnsafe(
      `UPDATE Partner
          SET priceAdjustmentRules = CAST(? AS JSON)
        WHERE id = ?`,
      JSON.stringify(rules),
      partnerId
    );

    return res.json({ ok: true, rules });
  } catch (e) {
    console.error("UPDATE PARTNER PRICE ADJUSTMENTS ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/by-id/:partnerId/price-adjustments/apply", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const adjustment = normalizePriceAdjustmentRule(
      {
        ...req.body,
        title: req.body?.title || "Ajuste permanente",
        status: "ACTIVE",
      },
      0
    );

    if (!adjustment) {
      return res.status(400).json({ error: "Invalid price adjustment" });
    }

    const partner = await getPartnerPolicyById(partnerId);

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    const pizzas = await prisma.menuPizza.findMany({
      where: buildPriceAdjustmentWhere(partnerId, adjustment),
      select: {
        id: true,
        priceBySize: true,
      },
    });

    if (pizzas.length) {
      await prisma.$transaction(
        pizzas.map((pizza) =>
          prisma.menuPizza.update({
            where: { id: pizza.id },
            data: {
              priceBySize: applyPercentToPriceBySize(
                pizza.priceBySize,
                adjustment.value
              ),
            },
          })
        )
      );
    }

    return res.json({
      ok: true,
      affectedProducts: pizzas.length,
      value: adjustment.value,
      targetType: adjustment.targetType,
    });
  } catch (e) {
    console.error("APPLY PARTNER PRICE ADJUSTMENT ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.patch("/by-id/:partnerId/storefront-buttons", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const buttonConfig = normalizeStorefrontButtonConfig(
      req.body?.storefrontButtonConfig || req.body
    );

    await prisma.$executeRawUnsafe(
      `UPDATE Partner
          SET storefrontButtonConfig = CAST(? AS JSON)
        WHERE id = ?`,
      JSON.stringify(buttonConfig),
      partnerId
    );

    const partner = await getPartnerPolicyById(partnerId);
    res.json(partner);
  } catch (e) {
    console.error("UPDATE PARTNER STOREFRONT BUTTONS ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.patch("/by-id/:partnerId/tracking-notifications", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const settings = normalizeTrackingNotificationSettings(
      req.body?.trackingNotificationSettings || req.body
    );

    await prisma.$executeRawUnsafe(
      `UPDATE Partner
          SET trackingNotificationSettings = CAST(? AS JSON)
        WHERE id = ?`,
      JSON.stringify(settings),
      partnerId
    );

    const partner = await getPartnerPolicyById(partnerId);
    res.json(partner);
  } catch (e) {
    console.error("UPDATE PARTNER TRACKING NOTIFICATIONS ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.patch("/by-id/:partnerId/branding", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE Partner
          SET brandPrimary = ?,
              brandSecondary = ?,
              brandAccent = ?,
              brandSurface = ?,
              brandTextColor = ?,
              brandFontFamily = ?,
              brandOfferButtonStyle = ?,
              storefrontMode = ?
        WHERE id = ?`,
      normalizeHexColor(req.body?.brandPrimary, "#3513A4"),
      normalizeHexColor(req.body?.brandSecondary, "#FFBF2D"),
      normalizeHexColor(req.body?.brandAccent, "#F7A600"),
      normalizeHexColor(req.body?.brandSurface, "#FFF7E8"),
      normalizeHexColor(req.body?.brandTextColor, "#171717"),
      String(req.body?.brandFontFamily || "").trim() || "moderno",
      String(req.body?.brandOfferButtonStyle || "").trim() || "sunset-pill",
      String(req.body?.storefrontMode || "").trim() || "commercial-light",
      partnerId
    );

    const partner = await getPartnerPolicyById(partnerId);
    res.json(partner);
  } catch (e) {
    console.error("UPDATE PARTNER BRANDING ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/by-id/:partnerId/logo", upload.single("logo"), async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const partnerId = Number(req.params.partnerId);

    if (!Number.isInteger(partnerId)) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const partner = await getPartnerPolicyById(partnerId);

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    if (partner.brandLogoPublicId) {
      try {
        assertCloudinaryConfigured();
        await cloudinary.uploader.destroy(partner.brandLogoPublicId);
      } catch (destroyError) {
        console.error("PARTNER LOGO DESTROY ERROR:", destroyError?.message || destroyError);
      }
    }

    const uploadedLogo = await uploadPartnerLogo(req.file, partnerId);

    await prisma.$executeRawUnsafe(
      `UPDATE Partner
          SET brandLogoUrl = ?,
              brandLogoPublicId = ?
        WHERE id = ?`,
      uploadedLogo.url,
      uploadedLogo.publicId,
      partnerId
    );

    const updatedPartner = await getPartnerPolicyById(partnerId);
    res.json(updatedPartner);
  } catch (e) {
    console.error("UPLOAD PARTNER LOGO ERROR:", e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
