import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, "..", ".env");

if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) return;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const normalizedValue = rawValue.replace(/^"(.*)"$/, "$1");

      if (!(key in process.env)) {
        process.env[key] = normalizedValue;
      }
    });
}

const prisma = new PrismaClient();
const dryRun = process.env.DRY_RUN !== "0";
const postalGeocodeCache = new Map();
const addressGeocodeCache = new Map();
const reverseGeocodeCache = new Map();

const extractZipCode = (value) => {
  const match = String(value || "").match(/\b(\d{5})\b/);
  return match ? match[1] : null;
};

const normalizeZipCode = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 5 ? digits : null;
};

const normalizeCountryCode = (value) => {
  const normalized = String(value || "ES").trim().toUpperCase();
  if (!normalized || normalized === "ESPAÑA" || normalized === "ESPANA" || normalized === "SPAIN") {
    return "ES";
  }
  return normalized.length === 2 ? normalized : "ES";
};

const postalAreaKey = (postalCode) => {
  const digits = String(postalCode || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(0, 3) : "";
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
  return hasUsableCoordinates(lat, lng) ? { lat, lng } : null;
};

const readObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const resolveCouponMetaZipCode = (coupon) => {
  const meta = readObject(coupon?.meta);
  return normalizeZipCode(meta.claimedFromZipCode || meta.targetCustomerZipCode || meta.zipCode);
};

const findTerritoryStore = (stores = [], zipCode) => {
  const normalizedZip = normalizeZipCode(zipCode);
  const area = postalAreaKey(normalizedZip);

  if (!normalizedZip && !area) return null;

  return (
    stores.find((store) => normalizeZipCode(store?.zipCode) === normalizedZip) ||
    stores.find((store) => area && postalAreaKey(store?.zipCode) === area) ||
    null
  );
};

const geocodePostalCode = async (zipCode, country) => {
  const normalizedZip = normalizeZipCode(zipCode);
  const googleKey = process.env.GOOGLE_GEOCODING_KEY;
  if (!normalizedZip || !googleKey) return null;

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
      timeout: 10000,
    });

    const location = response.data?.results?.[0]?.geometry?.location;
    const coords = hasUsableCoordinates(location?.lat, location?.lng)
      ? { lat: Number(location.lat), lng: Number(location.lng) }
      : null;

    postalGeocodeCache.set(cacheKey, coords);
    return coords;
  } catch (error) {
    console.warn(`[territory] geocode failed for ${normalizedZip}: ${error?.message || error}`);
    postalGeocodeCache.set(cacheKey, null);
    return null;
  }
};

const readPostalCodeFromComponents = (components = []) => {
  const component = components.find((item) => Array.isArray(item.types) && item.types.includes("postal_code"));
  return normalizeZipCode(component?.long_name || component?.short_name);
};

const geocodeAddress = async (address, country) => {
  const normalizedAddress = String(address || "").trim();
  const googleKey = process.env.GOOGLE_GEOCODING_KEY;
  if (!normalizedAddress || /^\([A-Z_]+\)/i.test(normalizedAddress) || !googleKey) return null;

  const countryCode = normalizeCountryCode(country);
  const cacheKey = `${countryCode}:${normalizedAddress.toLowerCase()}`;
  if (addressGeocodeCache.has(cacheKey)) return addressGeocodeCache.get(cacheKey);

  try {
    const response = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        address: `${normalizedAddress}, ${countryCode}`,
        components: `country:${countryCode}`,
        key: googleKey,
      },
      timeout: 10000,
    });

    const result = response.data?.results?.[0];
    const location = result?.geometry?.location;
    const coords = hasUsableCoordinates(location?.lat, location?.lng)
      ? { lat: Number(location.lat), lng: Number(location.lng) }
      : null;
    const zipCode = readPostalCodeFromComponents(result?.address_components || []);
    const territory = coords || zipCode ? { zipCode, coords } : null;

    addressGeocodeCache.set(cacheKey, territory);
    return territory;
  } catch (error) {
    console.warn(`[territory] address geocode failed for ${normalizedAddress}: ${error?.message || error}`);
    addressGeocodeCache.set(cacheKey, null);
    return null;
  }
};

const reverseGeocodeCoordinates = async (lat, lng, country) => {
  if (!hasUsableCoordinates(lat, lng) || !process.env.GOOGLE_GEOCODING_KEY) return null;

  const countryCode = normalizeCountryCode(country);
  const cacheKey = `${countryCode}:${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  if (reverseGeocodeCache.has(cacheKey)) return reverseGeocodeCache.get(cacheKey);

  try {
    const response = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        latlng: `${lat},${lng}`,
        result_type: "postal_code",
        key: process.env.GOOGLE_GEOCODING_KEY,
      },
      timeout: 10000,
    });

    const zipCode = readPostalCodeFromComponents(response.data?.results?.[0]?.address_components || []);
    reverseGeocodeCache.set(cacheKey, zipCode);
    return zipCode;
  } catch (error) {
    console.warn(`[territory] reverse geocode failed for ${lat},${lng}: ${error?.message || error}`);
    reverseGeocodeCache.set(cacheKey, null);
    return null;
  }
};

const resolveTerritory = async (customer, stores, country) => {
  const existingZip = normalizeZipCode(customer.zipCode);
  const addressZip = extractZipCode(customer.address_1);
  const latestSale = customer.sales?.[0] || null;
  const latestRedemption = customer.redemptions?.[0] || null;
  const assignedCoupon = customer.assignedCoupons?.[0] || null;

  const candidates = [
    {
      zipCode: existingZip,
      source: "customer",
      coords: getCoordinates(customer) || getCoordinates(findTerritoryStore(stores, existingZip)),
    },
    {
      zipCode: addressZip,
      source: "address",
      coords: getCoordinates(customer) || getCoordinates(findTerritoryStore(stores, addressZip)),
    },
    {
      zipCode: extractZipCode(latestSale?.address_1),
      source: "last_sale_address",
      coords: getCoordinates(latestSale) || getCoordinates(latestSale?.store),
    },
    {
      zipCode: normalizeZipCode(latestSale?.store?.zipCode),
      source: "last_sale_store",
      coords: getCoordinates(latestSale?.store),
    },
    {
      zipCode: normalizeZipCode(latestRedemption?.store?.zipCode),
      source: "last_coupon_store",
      coords: getCoordinates(latestRedemption?.store),
    },
    {
      zipCode: resolveCouponMetaZipCode(latestRedemption?.coupon),
      source: "last_coupon",
      coords: null,
    },
    {
      zipCode: resolveCouponMetaZipCode(assignedCoupon),
      source: "assigned_coupon",
      coords: null,
    },
  ].filter((candidate) => candidate.zipCode);

  const geocodedAddress = await geocodeAddress(customer.address_1, country);
  if (geocodedAddress?.zipCode || geocodedAddress?.coords) {
    candidates.push({
      zipCode: geocodedAddress.zipCode,
      source: "customer_address_geocode",
      coords: geocodedAddress.coords,
    });
  }

  for (const candidate of candidates) {
    const store = findTerritoryStore(stores, candidate.zipCode);
    const coords = candidate.coords || getCoordinates(store) || await geocodePostalCode(candidate.zipCode, country);
    if (coords) {
      return { ...candidate, coords };
    }
  }

  const saleStoreCoords = getCoordinates(latestSale?.store);
  if (saleStoreCoords) {
    const zipCode = normalizeZipCode(latestSale?.store?.zipCode) ||
      await reverseGeocodeCoordinates(saleStoreCoords.lat, saleStoreCoords.lng, country);
    return {
      zipCode,
      source: "last_sale_store_coordinates",
      coords: saleStoreCoords,
    };
  }

  const redemptionStoreCoords = getCoordinates(latestRedemption?.store);
  if (redemptionStoreCoords) {
    const zipCode = normalizeZipCode(latestRedemption?.store?.zipCode) ||
      await reverseGeocodeCoordinates(redemptionStoreCoords.lat, redemptionStoreCoords.lng, country);
    return {
      zipCode,
      source: "last_coupon_store_coordinates",
      coords: redemptionStoreCoords,
    };
  }

  return candidates[0] || null;
};

const partners = await prisma.partner.findMany({
  select: {
    id: true,
    name: true,
    country: true,
    stores: {
      select: {
        id: true,
        storeName: true,
        zipCode: true,
        latitude: true,
        longitude: true,
      },
    },
    customers: {
      select: {
        id: true,
        name: true,
        zipCode: true,
        address_1: true,
        lat: true,
        lng: true,
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
          },
        },
      },
    },
  },
});

let scanned = 0;
let updated = 0;
let unresolved = 0;
const samples = [];

for (const partner of partners) {
  for (const customer of partner.customers) {
    scanned += 1;

    const territory = await resolveTerritory(customer, partner.stores, partner.country);
    if (!territory?.zipCode && !territory?.coords) {
      unresolved += 1;
      continue;
    }

    const needsZip = !normalizeZipCode(customer.zipCode);
    const needsCoordinates = !hasUsableCoordinates(customer.lat, customer.lng);
    const data = {};

    if (needsZip && territory.zipCode) data.zipCode = territory.zipCode;
    if (needsCoordinates && territory.coords) {
      data.lat = territory.coords.lat;
      data.lng = territory.coords.lng;
    }

    if (!Object.keys(data).length) continue;

    updated += 1;
    if (samples.length < 12) {
      samples.push({
        id: customer.id,
        name: customer.name,
        source: territory.source,
        data,
      });
    }

    if (!dryRun) {
      await prisma.customer.update({
        where: { id: customer.id },
        data,
      });
    }
  }
}

console.log(JSON.stringify({
  dryRun,
  partners: partners.length,
  scanned,
  updated,
  unresolved,
  samples,
}, null, 2));

await prisma.$disconnect();
