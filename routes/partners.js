import express from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

const prisma = new PrismaClient();
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const GOOGLE_GEOCODING_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function ensurePartnerSettingsColumns() {
  const statements = [
    "ALTER TABLE `Partner` ADD COLUMN `deliveryRadiusKm` DOUBLE NULL",
    "ALTER TABLE `Partner` ADD COLUMN `deliveryPricingMode` ENUM('FIXED','VARIABLE') NOT NULL DEFAULT 'FIXED'",
    "ALTER TABLE `Partner` ADD COLUMN `deliveryFeeBlockSize` INT NULL DEFAULT 5",
    "ALTER TABLE `Partner` ADD COLUMN `deliveryMaxPizzasPerOrder` INT NULL",
    "ALTER TABLE `Partner` ADD COLUMN `deliveryFeeFixed` DOUBLE NULL",
    "ALTER TABLE `Partner` ADD COLUMN `deliveryFeeBase` DOUBLE NULL",
    "ALTER TABLE `Partner` ADD COLUMN `deliveryBaseKm` DOUBLE NULL",
    "ALTER TABLE `Partner` ADD COLUMN `deliveryExtraPerKm` DOUBLE NULL",
    "ALTER TABLE `Partner` ADD COLUMN `brandPrimary` VARCHAR(32) NULL",
    "ALTER TABLE `Partner` ADD COLUMN `brandSecondary` VARCHAR(32) NULL",
    "ALTER TABLE `Partner` ADD COLUMN `brandAccent` VARCHAR(32) NULL",
    "ALTER TABLE `Partner` ADD COLUMN `brandSurface` VARCHAR(32) NULL",
    "ALTER TABLE `Partner` ADD COLUMN `brandLogoUrl` TEXT NULL",
    "ALTER TABLE `Partner` ADD COLUMN `brandLogoPublicId` VARCHAR(255) NULL",
  ];

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      const message = String(error?.message || error);
      if (!message.includes("Duplicate column name")) {
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
            brandAccent, brandSurface, brandLogoUrl, brandLogoPublicId
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
            brandAccent, brandSurface, brandLogoUrl, brandLogoPublicId
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

function computeDeliveryFee(partner, distanceKm) {
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

router.post("/:slug/delivery/resolve", async (req, res) => {
  try {
    await ensurePartnerSettingsColumns();

    const address = String(req.body?.address || "").trim();

    if (!address) {
      return res.status(400).json({ error: "Address required" });
    }

    const googleKey = process.env.GOOGLE_GEOCODING_KEY;

    if (!googleKey) {
      return res.status(500).json({ error: "GOOGLE_GEOCODING_KEY not configured" });
    }

    const partner = await getPartnerPolicyBySlug(req.params.slug);

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    const stores = await prisma.store.findMany({
      where: {
        partnerId: Number(partner.id),
        active: true,
        acceptingOrders: true,
      },
      orderBy: { storeName: "asc" },
    });

    const customerGeocode = await geocodeCustomerAddress(
      address,
      partner,
      stores,
      googleKey
    );

    if (!customerGeocode) {
      return res.status(422).json({
        error: "ADDRESS_NOT_FOUND",
        message: "No pudimos ubicar esta direccion.",
      });
    }

    const lat = customerGeocode.lat;
    const lng = customerGeocode.lng;

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
      return res.status(422).json({
        error: "NO_STORES_WITH_COORDS",
        message: "No hay tiendas listas para calcular delivery.",
      });
    }

    const nearestStore = eligibleStores
      .map((store) => ({
        ...store,
        distanciaKm: haversineKm(lat, lng, store.latitude, store.longitude),
      }))
      .sort((a, b) => a.distanciaKm - b.distanciaKm)[0];

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
      nearestStore: {
        id: nearestStore.id,
        slug: nearestStore.slug,
        storeName: nearestStore.storeName,
        city: nearestStore.city,
        distanceKm: Number(nearestStore.distanciaKm.toFixed(2)),
      },
    });
  } catch (e) {
    console.error("DELIVERY RESOLVE ERROR:", e?.response?.data || e);
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
              brandSurface = COALESCE(?, brandSurface)
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
      partnerId
    );

    const partner = await getPartnerPolicyById(partnerId);

    res.json(partner);
  } catch (e) {
    console.error("UPDATE PARTNER DELIVERY POLICY ERROR:", e);
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
              brandSurface = ?
        WHERE id = ?`,
      normalizeHexColor(req.body?.brandPrimary, "#3513A4"),
      normalizeHexColor(req.body?.brandSecondary, "#FFBF2D"),
      normalizeHexColor(req.body?.brandAccent, "#F7A600"),
      normalizeHexColor(req.body?.brandSurface, "#FFF7E8"),
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

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(503).json({ error: "Cloudinary not configured" });
    }

    if (partner.brandLogoPublicId) {
      try {
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
