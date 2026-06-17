import express from "express";
import { getBoostSettings } from "../services/boostSettings.js";
import { sendStoreStatusTrackingSms } from "../services/trackingNotifications.js";
import { createTtlCache } from "../services/responseCache.js";
import {
  buildPosPinData,
  decryptPin,
  ensureStorePosCredentialColumns,
  generateSixDigitPin,
} from "../services/posCredentials.js";

const TZ = process.env.TIMEZONE || "Europe/Madrid";
const TRENDING_PRICE_BAND = 0.5;
const publicMenuCache = createTtlCache({
  name: "public-store-menu",
  ttlMs: Number(process.env.PUBLIC_MENU_CACHE_MS || 30_000),
  maxEntries: Number(process.env.PUBLIC_MENU_CACHE_MAX || 500),
});

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toNullableFloat = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasUsableStoreCoordinates = (store) => {
  const latitude = toNullableFloat(store?.latitude);
  const longitude = toNullableFloat(store?.longitude);
  return (
    latitude != null &&
    longitude != null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

const storeCoordinatesRequiredResponse = (res) =>
  res.status(409).json({
    error: "store_coordinates_required",
    message:
      "Completa latitud y longitud de la tienda antes de activarla.",
  });

const sanitizeStore = (store) => {
  if (!store || typeof store !== "object") return store;

  const { posPinHash, posPinEncrypted, ...safeStore } = store;
  return {
    ...safeStore,
    posCredentialsConfigured: Boolean(posPinHash),
    posCredentialsRecoverable: Boolean(posPinEncrypted),
    posCredentialsEnabled: store.posCredentialsEnabled !== false,
    posPinUpdatedAt: store.posPinUpdatedAt || null,
  };
};

const toNullableInt = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildStorePayload = (body) => {
  const acceptsReservations = Boolean(body.acceptsReservations);
  const reservationCapacity = acceptsReservations
    ? toNullableInt(body.reservationCapacity) ?? 0
    : null;

  const latitude = toNullableFloat(body.latitude);
  const longitude = toNullableFloat(body.longitude);
  const hasCoordinates = hasUsableStoreCoordinates({ latitude, longitude });
  const explicitActive = typeof body.active === "boolean";

  return {
    storeName: String(body.storeName || body.name || "").trim(),
    slug: slugify(body.slug || body.storeName || body.name),
    address: String(body.address || "").trim(),
    city: body.city ? String(body.city).trim() : null,
    zipCode: body.zipCode ? String(body.zipCode).trim() : null,
    email: body.email ? String(body.email).trim() : null,
    tlf: body.tlf ? String(body.tlf).trim() : null,
    latitude,
    longitude,
    active: explicitActive ? body.active : hasCoordinates,
    acceptingOrders:
      typeof body.acceptingOrders === "boolean" ? body.acceptingOrders : true,
    acceptsReservations,
    reservationCapacity,
  };
};

const zeroStockForNewStore = async (tx, storeId, partnerId) => {
  const pizzas = await tx.menuPizza.findMany({
    where: { partnerId },
    select: { id: true },
  });

  if (!pizzas.length) return;

  await tx.storePizzaStock.createMany({
    data: pizzas.map((pizza) => ({
      storeId,
      pizzaId: pizza.id,
      stock: 0,
      active: false,
    })),
    skipDuplicates: true,
  });
};

const dayLabels = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miercoles",
  "Jueves",
  "Viernes",
  "Sabado",
];

const normalizePromoDaysActive = (value) => {
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

  return [...new Set(
    list
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
  )].sort();
};

const minutesOfDay = (date) => date.getHours() * 60 + date.getMinutes();

const nowInTZ = () => {
  const snapshot = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  return new Date(snapshot.replace(" ", "T"));
};

const parseMaybeJson = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

const normalizePriceAdjustmentRules = (value) => {
  const parsed = parseMaybeJson(value, []);
  const list = Array.isArray(parsed) ? parsed : [];

  return list
    .map((rule) => ({
      id: String(rule?.id || "").trim(),
      title: String(rule?.title || "").trim(),
      type: "PERCENT",
      value: Number(rule?.value),
      targetType: String(rule?.targetType || "ALL").toUpperCase(),
      categoryIds: normalizePositiveIds(rule?.categoryIds),
      productIds: normalizePositiveIds(rule?.productIds),
      storeIds: normalizePositiveIds(rule?.storeIds),
      activeFrom: rule?.activeFrom ? new Date(rule.activeFrom) : null,
      expiresAt: rule?.expiresAt ? new Date(rule.expiresAt) : null,
      daysActive: normalizePromoDaysActive(rule?.daysActive),
      windowStart: rule?.windowStart == null ? null : Number(rule.windowStart),
      windowEnd: rule?.windowEnd == null ? null : Number(rule.windowEnd),
      status: String(rule?.status || "ACTIVE").toUpperCase(),
    }))
    .filter((rule) => Number.isFinite(rule.value) && rule.value !== 0);
};

const normalizeProductKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isBeverageCategory = (value) => normalizeProductKey(value) === "bebidas";

const getSaleLineQty = (item) => {
  const qty = Number(item?.quantity ?? item?.qty ?? item?.cantidad ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
};

const getSaleLinePizzaId = (item, pizzaIdByName) => {
  const directId = Number(item?.pizzaId ?? item?.menuPizzaId ?? item?.productId);
  if (Number.isInteger(directId) && directId > 0) return directId;

  const nameKey = normalizeProductKey(
    item?.name || item?.pizzaName || item?.title || item?.productName
  );
  return pizzaIdByName.get(nameKey) || null;
};

const formatLastOrderedLabel = (date, reference) => {
  if (!date) return "Sin pedidos recientes";

  const diffMinutes = Math.max(
    Math.floor((reference.getTime() - date.getTime()) / 60000),
    0
  );

  if (diffMinutes < 1) return "Pedida ahora";
  if (diffMinutes < 60) return `Pedida hace ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Pedida hace ${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `Pedida hace ${diffDays}d`;

  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
  }).format(date);
};

const buildTrendingPricing = (priceBySize = {}) => {
  const basePriceBySize = {};
  const floorPriceBySize = {};
  const ceilingPriceBySize = {};

  Object.entries(priceBySize || {}).forEach(([size, price]) => {
    const parsed = Number(price);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    basePriceBySize[size] = roundMoney(parsed);
    floorPriceBySize[size] = roundMoney(Math.max(0, parsed - TRENDING_PRICE_BAND));
    ceilingPriceBySize[size] = roundMoney(parsed + TRENDING_PRICE_BAND);
  });

  return {
    mode: "FLOATING_BAND",
    band: TRENDING_PRICE_BAND,
    basePriceBySize,
    floorPriceBySize,
    ceilingPriceBySize,
  };
};

const attachTrendingPricing = (pizza) => ({
  ...pizza,
  sourceCategoryId: pizza.categoryId ?? null,
  sourceCategory: pizza.category ?? null,
  trendingPricing: buildTrendingPricing(pizza.priceBySize),
});

const buildTrendingMenu = async (prisma, { storeId, menu, now }) => {
  const menuById = new Map(menu.map((pizza) => [pizza.pizzaId, pizza]));
  const pizzaIdByName = new Map(
    menu.map((pizza) => [normalizeProductKey(pizza.name), pizza.pizzaId])
  );
  const currentWeekStart = new Date(now);
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  const previousWeekStart = new Date(now);
  previousWeekStart.setDate(previousWeekStart.getDate() - 14);

  const sales = await prisma.sale.findMany({
    where: {
      storeId,
      status: { not: "CANCELED" },
    },
    select: {
      date: true,
      createdAt: true,
      products: true,
    },
    orderBy: { date: "desc" },
  });

  const metricsByPizzaId = new Map();
  const ensureMetrics = (pizzaId) => {
    const current =
      metricsByPizzaId.get(pizzaId) || {
        soldLast7Days: 0,
        soldPrevious7Days: 0,
        soldAllTime: 0,
        lastOrderedAt: null,
      };
    metricsByPizzaId.set(pizzaId, current);
    return current;
  };

  sales.forEach((sale) => {
    const saleDate = new Date(sale.date || sale.createdAt);
    const products = Array.isArray(sale.products) ? sale.products : [];

    products.forEach((item) => {
      const pizzaId = getSaleLinePizzaId(item, pizzaIdByName);
      if (!pizzaId || !menuById.has(pizzaId)) return;

      const qty = getSaleLineQty(item);
      const metrics = ensureMetrics(pizzaId);
      metrics.soldAllTime += qty;

      if (!metrics.lastOrderedAt || saleDate > metrics.lastOrderedAt) {
        metrics.lastOrderedAt = saleDate;
      }

      if (saleDate >= currentWeekStart && saleDate <= now) {
        metrics.soldLast7Days += qty;
      } else if (saleDate >= previousWeekStart && saleDate < currentWeekStart) {
        metrics.soldPrevious7Days += qty;
      }
    });
  });

  const ranked = menu
    .filter((pizza) => !isBeverageCategory(pizza.category))
    .map((pizza) => {
      const metrics = ensureMetrics(pizza.pizzaId);
      const trendDelta = metrics.soldLast7Days - metrics.soldPrevious7Days;
      const trendPercent =
        metrics.soldPrevious7Days > 0
          ? Math.round((trendDelta / metrics.soldPrevious7Days) * 100)
          : metrics.soldLast7Days > 0
          ? 100
          : 0;

      return {
        ...pizza,
        trend: {
          soldLast7Days: metrics.soldLast7Days,
          soldPrevious7Days: metrics.soldPrevious7Days,
          soldAllTime: metrics.soldAllTime,
          trendDelta,
          trendPercent,
          lastOrderedAt: metrics.lastOrderedAt,
          lastOrderedLabel: formatLastOrderedLabel(metrics.lastOrderedAt, now),
          rankingBasis: "bestSellers",
        },
      };
    })
    .filter((pizza) => pizza.trend.soldLast7Days > 0 || pizza.trend.soldAllTime > 0)
    .sort((left, right) => {
      if (right.trend.soldAllTime !== left.trend.soldAllTime) {
        return right.trend.soldAllTime - left.trend.soldAllTime;
      }
      if (right.trend.soldLast7Days !== left.trend.soldLast7Days) {
        return right.trend.soldLast7Days - left.trend.soldLast7Days;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, 3)
    .map((pizza, index) => ({
      ...pizza,
      trend: {
        ...pizza.trend,
        rank: index + 1,
      },
    }));

  const rankedIds = new Set(ranked.map((pizza) => pizza.pizzaId));
  const fillers = menu
    .filter((pizza) => !rankedIds.has(pizza.pizzaId) && !isBeverageCategory(pizza.category))
    .slice(0, Math.max(3 - ranked.length, 0))
    .map((pizza, index) => ({
      ...pizza,
      trend: {
        rank: ranked.length + index + 1,
        soldLast7Days: 0,
        soldPrevious7Days: 0,
        soldAllTime: 0,
        trendDelta: 0,
        trendPercent: 0,
        lastOrderedAt: null,
        lastOrderedLabel: "Aun sin ventas",
        rankingBasis: "menuFallback",
      },
    }));

  return [...ranked, ...fillers].slice(0, 3).map(attachTrendingPricing);
};

const isPromoWithinWindow = (promo, reference) => {
  const days = normalizePromoDaysActive(promo.daysActive);
  if (!days.length && promo.windowStart == null && promo.windowEnd == null) return true;

  if (days.length && !days.includes(reference.getDay())) return false;

  const start = promo.windowStart == null ? 0 : Number(promo.windowStart);
  const end = promo.windowEnd == null ? 24 * 60 : Number(promo.windowEnd);
  const minutes = minutesOfDay(reference);

  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
};

const isPriceAdjustmentWithinWindow = (rule, reference) => {
  if (rule.status !== "ACTIVE") return false;
  if (rule.activeFrom && rule.activeFrom > reference) return false;
  if (rule.expiresAt && rule.expiresAt <= reference) return false;
  return isPromoWithinWindow(rule, reference);
};

const asIdSet = (value) => {
  const list = Array.isArray(value) ? value : [];
  return new Set(
    list
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)
  );
};

const normalizeComparableText = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const discountAppliesToPizza = (discount, pizza) => {
  const targetType = String(discount?.targetType || "").toUpperCase();
  const productIds = asIdSet(discount.productIds);

  if (productIds.has(Number(pizza.id))) return true;

  if (targetType === "PRODUCT") {
    return false;
  }

  if (targetType !== "CATEGORY") return false;

  const categoryIds = asIdSet(discount.categoryIds);
  if (categoryIds.has(Number(pizza.categoryId))) return true;

  const categoryNames = Array.isArray(discount.categoryNames) ? discount.categoryNames : [];
  const pizzaCategory = normalizeComparableText(pizza.category);
  return categoryNames.some((categoryName) => normalizeComparableText(categoryName) === pizzaCategory);
};

const discountAppliesToStore = (discount, storeId) => {
  const storeIds = asIdSet(discount.storeIds);
  return storeIds.size === 0 || storeIds.has(Number(storeId));
};

const priceAdjustmentAppliesToPizza = (rule, pizza, storeId) => {
  const storeIds = asIdSet(rule.storeIds);
  if (storeIds.size > 0 && !storeIds.has(Number(storeId))) return false;

  if (rule.targetType === "ALL") return true;

  if (rule.targetType === "PRODUCT") {
    return asIdSet(rule.productIds).has(Number(pizza.id || pizza.pizzaId));
  }

  if (rule.targetType === "CATEGORY") {
    return asIdSet(rule.categoryIds).has(Number(pizza.categoryId));
  }

  return false;
};

const applyPriceAdjustmentRulesToPizza = (pizza, rules, storeId) => {
  const activeRules = rules.filter((rule) =>
    priceAdjustmentAppliesToPizza(rule, pizza, storeId)
  );

  if (!activeRules.length) return pizza;

  const originalBasePriceBySize = pizza.priceBySize || {};
  const adjustedPriceBySize = Object.entries(originalBasePriceBySize).reduce(
    (nextPrices, [size, price]) => {
      const basePrice = Number(price);
      if (!Number.isFinite(basePrice) || basePrice <= 0) {
        nextPrices[size] = price;
        return nextPrices;
      }

      const adjusted = activeRules.reduce(
        (currentPrice, rule) => currentPrice * (1 + Number(rule.value || 0) / 100),
        basePrice
      );
      nextPrices[size] = roundMoney(Math.max(0, adjusted));
      return nextPrices;
    },
    {}
  );

  return {
    ...pizza,
    originalBasePriceBySize,
    priceBySize: adjustedPriceBySize,
    priceAdjustments: activeRules.map((rule) => ({
      id: rule.id,
      title: rule.title,
      value: rule.value,
      targetType: rule.targetType,
    })),
  };
};

const getDiscountedPrice = (price, discount) => {
  const original = Number(price || 0);
  const value = Number(discount?.value || 0);

  if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(value) || value <= 0) {
    return original;
  }

  if (discount.discountType === "PERCENT") {
    return Math.max(0, Math.round(original * (1 - Math.min(value, 100) / 100) * 100) / 100);
  }

  return Math.max(0, Math.round((original - value) * 100) / 100);
};

const getDiscountSaving = (price, discount) => {
  const original = Number(price || 0);
  return Math.max(0, Math.round((original - getDiscountedPrice(original, discount)) * 100) / 100);
};

const chooseBestDiscountForPizza = (pizza, discounts, storeId) => {
  const candidates = discounts.filter(
    (discount) => discountAppliesToStore(discount, storeId) && discountAppliesToPizza(discount, pizza)
  );

  if (!candidates.length) return null;

  const prices = Object.values(pizza.priceBySize || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const referencePrice = prices.length ? Math.min(...prices) : 0;

  return candidates
    .slice()
    .sort((left, right) => getDiscountSaving(referencePrice, right) - getDiscountSaving(referencePrice, left))[0];
};

const applyDirectDiscountToPizza = (pizza, discount) => {
  if (!discount) return pizza;

  const originalPriceBySize = pizza.priceBySize || {};
  const priceBySize = Object.fromEntries(
    Object.entries(originalPriceBySize).map(([size, price]) => [
      size,
      getDiscountedPrice(price, discount),
    ])
  );

  return {
    ...pizza,
    originalPriceBySize,
    priceBySize,
    directDiscount: {
      id: discount.id,
      title: discount.title,
      discountType: discount.discountType,
      value: Number(discount.value || 0),
      activeFrom: discount.activeFrom,
      expiresAt: discount.expiresAt,
      windowStart: discount.windowStart,
      windowEnd: discount.windowEnd,
      daysActive: normalizePromoDaysActive(discount.daysActive),
    },
  };
};

const attachStorePublicMenu = (router, prisma) => {
  router.get("/:partnerSlug/:storeSlug/menu", async (req, res) => {
    try {
      const { partnerSlug, storeSlug } = req.params;
      const cacheKey = `${partnerSlug}:${storeSlug}`;
      const cachedPayload = publicMenuCache.get(cacheKey);

      if (cachedPayload) {
        res.set("X-Volta-Cache", "HIT public-store-menu");
        return res.json(cachedPayload);
      }

      const partner = await prisma.partner.findUnique({
        where: { slug: partnerSlug },
      });

      if (!partner) {
        return res.status(404).json({ error: "Partner not found" });
      }

      let priceAdjustmentRows = [];
      try {
        priceAdjustmentRows = await prisma.$queryRawUnsafe(
          "SELECT priceAdjustmentRules FROM Partner WHERE id = ?",
          partner.id
        );
      } catch (priceAdjustmentError) {
        console.warn(
          "[stores.menu] price adjustments unavailable:",
          priceAdjustmentError?.code || priceAdjustmentError?.message
        );
      }

      const store = await prisma.store.findFirst({
        where: {
          slug: storeSlug,
          partnerId: partner.id,
        },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      if (store.active === false || !hasUsableStoreCoordinates(store)) {
        return res.status(404).json({ error: "Store not active" });
      }

      const pizzas = await prisma.menuPizza.findMany({
        where: {
          partnerId: store.partnerId,
          status: "ACTIVE",
          type: "SELLABLE",
        },
        select: {
          id: true,
          name: true,
          category: true,
          categoryId: true,
          cookingMethod: true,
          selectSize: true,
          priceBySize: true,
          image: true,
          launchAt: true,
          availableUntil: true,
          productTags: true,
          categoryRef: {
            select: {
              position: true,
              customizable: true,
            },
          },
          stocks: {
            where: { storeId: store.id },
            select: {
              active: true,
              stock: true,
            },
          },
          ingredients: {
            select: {
              qtyBySize: true,
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  allergens: true,
                  status: true,
                  storeStocks: {
                    where: { storeId: store.id },
                    select: { active: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { id: "asc" },
      });

      const categoryIds = [
        ...new Set(
          pizzas
            .map((pizza) => Number(pizza.categoryId))
            .filter((id) => Number.isInteger(id) && id > 0)
        ),
      ];
      const categoryHalfRows = categoryIds.length
        ? await prisma.$queryRawUnsafe(
            `SELECT id, halfAndHalf FROM Category WHERE id IN (${categoryIds.join(",")})`
          )
        : [];
      const categoryHalfAndHalfById = new Map(
        categoryHalfRows.map((row) => [Number(row.id), Boolean(row.halfAndHalf)])
      );

      const availablePizzas = pizzas.filter((pizza) => {
        const storePizzaState = pizza.stocks?.[0];

        if (!storePizzaState || storePizzaState.active !== true) {
          return false;
        }

        return (pizza.ingredients || []).every((rel) => {
          const ingredient = rel.ingredient;
          const storeStock = ingredient?.storeStocks?.[0];
          return ingredient?.status === "ACTIVE" && storeStock?.active === true;
        });
      });
      const approvalByPizzaId = new Map();
      const approvalPizzaIds = [
        ...new Set(
          availablePizzas
            .map((pizza) => Number(pizza.id))
            .filter((id) => Number.isInteger(id) && id > 0)
        ),
      ];

      if (approvalPizzaIds.length) {
        try {
          const approvalRows = await prisma.productReviewVote.groupBy({
            by: ["productId", "vote"],
            where: {
              storeId: store.id,
              productId: { in: approvalPizzaIds },
              vote: { in: ["LIKE", "DISLIKE"] },
            },
            _count: { _all: true },
          });

          approvalRows.forEach((row) => {
            const productId = Number(row.productId);
            if (!Number.isInteger(productId) || productId <= 0) return;

            const current =
              approvalByPizzaId.get(productId) || {
                likes: 0,
                dislikes: 0,
                total: 0,
                approvalPercent: 0,
              };
            const count = Number(row._count?._all || 0);

            if (row.vote === "LIKE") current.likes += count;
            if (row.vote === "DISLIKE") current.dislikes += count;
            current.total = current.likes + current.dislikes;
            current.approvalPercent = current.total
              ? Math.round((current.likes / current.total) * 100)
              : 0;
            approvalByPizzaId.set(productId, current);
          });
        } catch (approvalError) {
          console.warn("[stores.menu] product approvals unavailable:", approvalError?.code || approvalError?.message);
        }
      }

      const now = new Date();
      let directDiscountRows = [];
      try {
        directDiscountRows = await prisma.directDiscount.findMany({
          where: {
            partnerId: store.partnerId,
            status: "ACTIVE",
            AND: [
              {
                OR: [
                  { activeFrom: null },
                  { activeFrom: { lte: now } },
                ],
              },
              {
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: now } },
                ],
              },
            ],
          },
          orderBy: { createdAt: "desc" },
        });
      } catch (discountError) {
        console.warn("[stores.menu] direct discounts unavailable:", discountError?.code || discountError?.message);
        directDiscountRows = [];
      }
      const directDiscountWindowNow = nowInTZ();
      const activeDirectDiscounts = directDiscountRows.filter((discount) =>
        isPromoWithinWindow(discount, directDiscountWindowNow)
      );
      const priceAdjustmentWindowNow = nowInTZ();
      const activePriceAdjustments = normalizePriceAdjustmentRules(
        priceAdjustmentRows?.[0]?.priceAdjustmentRules
      ).filter((rule) => isPriceAdjustmentWithinWindow(rule, priceAdjustmentWindowNow));
      const mapPublicPizza = (
        pizza,
        available,
        { applyDiscount = true, applyPriceAdjustments = true } = {}
      ) => {
        const publicPizzaBase = {
          pizzaId: pizza.id,
          id: pizza.id,
          name: pizza.name,
          categoryId: pizza.categoryId ?? null,
          category: pizza.category ?? null,
          categoryPosition: pizza.categoryRef?.position ?? 999,
          categoryCustomizable: pizza.categoryRef?.customizable ?? false,
          categoryHalfAndHalf:
            categoryHalfAndHalfById.get(Number(pizza.categoryId)) ?? false,
          cookingMethod: pizza.cookingMethod ?? null,
          selectSize: pizza.selectSize ?? [],
          priceBySize: pizza.priceBySize ?? {},
          image: pizza.image ?? null,
          launchAt: pizza.launchAt ?? null,
          availableUntil: pizza.availableUntil ?? null,
          productTags: Array.isArray(pizza.productTags) ? pizza.productTags : [],
          approval:
            approvalByPizzaId.get(Number(pizza.id)) || {
              likes: 0,
              dislikes: 0,
              total: 0,
              approvalPercent: 0,
            },
          stock: pizza.stocks?.[0]?.stock ?? null,
          ingredients: (pizza.ingredients || []).map((rel) => ({
            id: rel.ingredient.id,
            name: rel.ingredient.name,
            allergens: Array.isArray(rel.ingredient.allergens)
              ? rel.ingredient.allergens
              : [],
            qtyBySize: rel.qtyBySize ?? {},
          })),
          extras: [],
          available,
        };

        const bestDiscount = chooseBestDiscountForPizza(pizza, activeDirectDiscounts, store.id);
        const shouldApplyPriceAdjustment =
          applyPriceAdjustments && !bestDiscount && !pizza.trend;
        const publicPizza = shouldApplyPriceAdjustment
          ? applyPriceAdjustmentRulesToPizza(publicPizzaBase, activePriceAdjustments, store.id)
          : publicPizzaBase;

        if (!applyDiscount) return publicPizza;

        return applyDirectDiscountToPizza(publicPizza, bestDiscount);
      };
      const menu = availablePizzas
        .filter((pizza) => (!pizza.launchAt || pizza.launchAt <= now) && (!pizza.availableUntil || pizza.availableUntil > now))
        .map((pizza) => mapPublicPizza(pizza, true));
      const trendingSourceMenu = availablePizzas
        .filter((pizza) => (!pizza.launchAt || pizza.launchAt <= now) && (!pizza.availableUntil || pizza.availableUntil > now))
        .map((pizza) =>
          mapPublicPizza(pizza, true, {
            applyDiscount: false,
            applyPriceAdjustments: false,
          })
        );
      const upcoming = availablePizzas
        .filter((pizza) => pizza.launchAt && pizza.launchAt > now && (!pizza.availableUntil || pizza.availableUntil > now))
        .map((pizza) => mapPublicPizza(pizza, false));
      const trending = await buildTrendingMenu(prisma, {
        storeId: store.id,
        menu: trendingSourceMenu,
        now,
      });
      const trendingByPizzaId = new Map(
        trending
          .map((pizza) => [Number(pizza.pizzaId), pizza])
          .filter(([pizzaId]) => Number.isInteger(pizzaId) && pizzaId > 0)
      );
      const baseMenu = menu.map((pizza) =>
        trendingByPizzaId.has(Number(pizza.pizzaId))
          ? {
              ...pizza,
              ...trendingByPizzaId.get(Number(pizza.pizzaId)),
              directDiscount: null,
              originalPriceBySize: null,
              categoryId: pizza.categoryId,
              category: pizza.category,
              categoryPosition: pizza.categoryPosition,
              categoryCustomizable: pizza.categoryCustomizable,
              categoryHalfAndHalf: pizza.categoryHalfAndHalf,
            }
          : pizza
      );
      const boostSettings = await getBoostSettings(prisma);
      const promos = await prisma.promo.findMany({
        where: {
          partnerId: store.partnerId,
          status: "ACTIVE",
          AND: [
            {
              OR: [
                { activeFrom: null },
                { activeFrom: { lte: now } },
              ],
            },
            {
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: now } },
              ],
            },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
      const promoWindowNow = nowInTZ();
      const visiblePromos = promos.filter((promo) =>
        isPromoWithinWindow(promo, promoWindowNow)
      );
      const salesSummary = await prisma.sale.aggregate({
        where: {
          storeId: store.id,
          status: { not: "CANCELED" },
        },
        _avg: { total: true },
      });

      const payload = {
        store: {
          id: store.id,
          partnerId: store.partnerId,
          storeName: store.storeName,
          slug: store.slug,
          address: store.address,
          city: store.city,
          tlf: store.tlf,
          acceptsReservations: store.acceptsReservations,
        },
        menu: baseMenu,
        trending,
        upcoming,
        boostSettings,
        incentiveStats: {
          averageTicket: Number(salesSummary._avg.total || 0),
        },
        promos: visiblePromos.map((promo) => ({
          id: promo.id,
          title: promo.title,
          description: promo.description,
          items: Array.isArray(promo.items) ? promo.items : [],
          totalPrice: Number(promo.totalPrice || 0),
          activeFrom: promo.activeFrom,
          expiresAt: promo.expiresAt,
          daysActive: normalizePromoDaysActive(promo.daysActive),
          windowStart: promo.windowStart,
          windowEnd: promo.windowEnd,
          image: promo.image,
        })),
      };

      publicMenuCache.set(cacheKey, payload);
      res.set("X-Volta-Cache", "MISS public-store-menu");
      return res.json(payload);
    } catch (error) {
      console.error("GET /stores/:partnerSlug/:storeSlug/menu", error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.get("/:partnerSlug/:storeSlug", async (req, res) => {
    try {
      const { partnerSlug, storeSlug } = req.params;

      const partner = await prisma.partner.findUnique({
        where: { slug: partnerSlug },
      });

      if (!partner) {
        return res.status(404).json({ error: "Partner not found" });
      }

      const store = await prisma.store.findFirst({
        where: {
          slug: storeSlug,
          partnerId: partner.id,
        },
        include: {
          partner: true,
          hours: {
            orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
          },
        },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      if (store.active === false || !hasUsableStoreCoordinates(store)) {
        return res.status(404).json({ error: "Store not active" });
      }

      return res.json(sanitizeStore(store));
    } catch (error) {
      console.error("GET /stores/:partnerSlug/:storeSlug", error);
      return res.status(500).json({ error: error.message });
    }
  });
};

export default function storesRoutes(prisma) {
  const router = express.Router();

  router.patch("/:id/active", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    const { active } = req.body;
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "body.active boolean required" });
    }

    try {
      const previous = await prisma.store.findUnique({
        where: { id },
        select: { active: true, latitude: true, longitude: true },
      });

      if (!previous) {
        return res.status(404).json({ error: "Store not found" });
      }

      if (active && !hasUsableStoreCoordinates(previous)) {
        return storeCoordinatesRequiredResponse(res);
      }

      const updated = await prisma.store.update({
        where: { id },
        data: { active },
        include: {
          partner: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      let notification = null;
      if (previous?.active !== updated.active) {
        if (updated.partnerId) {
          const partnerRows = await prisma.$queryRawUnsafe(
            "SELECT trackingNotificationSettings FROM Partner WHERE id = ?",
            updated.partnerId
          );
          updated.partner = {
            ...(updated.partner || {}),
            trackingNotificationSettings:
              partnerRows?.[0]?.trackingNotificationSettings || null,
          };
        }

        try {
          notification = await sendStoreStatusTrackingSms(prisma, {
            store: updated,
          });
        } catch (notificationError) {
          console.error("[PATCH /stores/:id/active notification]", notificationError);
          notification = {
            ok: false,
            skipped: true,
            reason: "notification_failed",
          };
        }
      }

      return res.json({ ok: true, active: updated.active, notification });
    } catch (error) {
      console.error("[PATCH /stores/:id/active]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  router.get("/nearest", async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const partnerId = req.query.partnerId
      ? parsePositiveInt(req.query.partnerId)
      : null;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "coords requeridas" });
    }

    try {
      const stores = await prisma.store.findMany({
        where: {
          active: true,
          ...(partnerId ? { partnerId } : {}),
        },
      });

      const toRad = (value) => (value * Math.PI) / 180;
      const haversineKm = (from, to) => {
        const dLat = toRad(to.lat - from.lat);
        const dLng = toRad(to.lng - from.lng);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(from.lat)) *
            Math.cos(toRad(to.lat)) *
            Math.sin(dLng / 2) ** 2;
        return 2 * 6371 * Math.asin(Math.sqrt(a));
      };

      let best = null;

      stores.forEach((store) => {
        if (store.latitude == null || store.longitude == null) return;

        const distanceKm = haversineKm(
          { lat, lng },
          { lat: store.latitude, lng: store.longitude }
        );

        if (!best || distanceKm < best.distanceKm) {
          best = { store, distanceKm };
        }
      });

      if (!best) {
        return res.status(404).json({ error: "no stores with coords" });
      }

      return res.json({
        storeId: best.store.id,
        storeName: best.store.storeName,
        slug: best.store.slug,
        distanciaKm: Number(best.distanceKm.toFixed(2)),
      });
    } catch (error) {
      console.error("[GET /stores/nearest]", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.get("/reservations-enabled", async (req, res) => {
    try {
      const partnerId = req.query.partnerId
        ? parsePositiveInt(req.query.partnerId)
        : null;

      const stores = await prisma.store.findMany({
        where: {
          acceptsReservations: true,
          active: true,
          ...(partnerId ? { partnerId } : {}),
        },
        select: {
          id: true,
          partnerId: true,
          slug: true,
          storeName: true,
          reservationCapacity: true,
        },
        orderBy: { storeName: "asc" },
      });

      return res.json(stores.map(sanitizeStore));
    } catch (error) {
      console.error("[GET /stores/reservations-enabled]", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.get("/:id/report", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    try {
      const store = await prisma.store.findUnique({
        where: { id },
        select: {
          id: true,
          storeName: true,
          partnerId: true,
          partner: {
            select: {
              currency: true,
            },
          },
        },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      const sales = await prisma.sale.findMany({
        where: {
          storeId: id,
          status: { not: "CANCELED" },
        },
        select: {
          id: true,
          total: true,
          date: true,
          createdAt: true,
          channel: true,
          delivery: true,
        },
        orderBy: { date: "desc" },
      });

      const safeSales = sales.filter((sale) => Number.isFinite(Number(sale.total)));
      const totalSales = safeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
      const ordersCount = safeSales.length;
      const averageTicket = ordersCount ? totalSales / ordersCount : 0;

      const hourBuckets = new Map();
      const dayBuckets = new Map();
      const channelBuckets = new Map();

      safeSales.forEach((sale) => {
        const date = sale.date || sale.createdAt;
        const current = new Date(date);
        const hour = current.getHours();
        const day = current.getDay();

        hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
        dayBuckets.set(day, (dayBuckets.get(day) || 0) + Number(sale.total || 0));
        channelBuckets.set(sale.channel, (channelBuckets.get(sale.channel) || 0) + 1);
      });

      const bestHourEntry = [...hourBuckets.entries()].sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0] - right[0];
      })[0];

      const bestDayEntry = [...dayBuckets.entries()].sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0] - right[0];
      })[0];

      const bestChannelEntry = [...channelBuckets.entries()].sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return String(left[0] || "").localeCompare(String(right[0] || ""));
      })[0];

      return res.json({
        storeId: store.id,
        storeName: store.storeName,
        currency: store.partner?.currency || "EUR",
        periodLabel: ordersCount ? "Historico actual" : "Sin ventas todavia",
        kpis: {
          totalSales,
          ordersCount,
          averageTicket,
          bestHour: bestHourEntry
            ? `${String(bestHourEntry[0]).padStart(2, "0")}:00`
            : null,
          bestHourOrders: bestHourEntry?.[1] || 0,
          bestDay: bestDayEntry ? dayLabels[bestDayEntry[0]] : null,
          bestDaySales: bestDayEntry?.[1] || 0,
          topChannel: bestChannelEntry?.[0] || null,
          topChannelCount: bestChannelEntry?.[1] || 0,
        },
        lastSaleAt: safeSales[0]?.date || safeSales[0]?.createdAt || null,
      });
    } catch (error) {
      console.error("[GET /stores/:id/report]", error);
      return res.status(500).json({ error: "Error building store report" });
    }
  });

  router.get("/:id", async (req, res, next) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return next();

    try {
      const store = await prisma.store.findUnique({
        where: { id },
        include: {
          partner: true,
          hours: {
            orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
          },
        },
      });

      if (!store) {
        return res.status(404).json({ error: "not found" });
      }

      return res.json(sanitizeStore(store));
    } catch (error) {
      console.error("[GET /stores/:id]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  router.get("/", async (req, res) => {
    try {
      await ensureStorePosCredentialColumns(prisma);

      const partnerId = req.query.partnerId
        ? parsePositiveInt(req.query.partnerId)
        : null;

      const stores = await prisma.store.findMany({
        where: partnerId ? { partnerId } : undefined,
        orderBy: [{ partnerId: "asc" }, { id: "desc" }],
      });

      return res.json(stores.map(sanitizeStore));
    } catch (error) {
      console.error("[GET /stores]", error);
      return res.status(500).json({ error: "Error fetching stores" });
    }
  });

  router.get("/:id/pos-credentials", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    try {
      await ensureStorePosCredentialColumns(prisma);

      const store = await prisma.store.findUnique({
        where: { id },
        include: { partner: true },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      let pin = decryptPin(store.posPinEncrypted);
      let updated = store;
      let regenerated = false;

      if (!pin || !/^\d{6}$/.test(pin)) {
        pin = generateSixDigitPin();
        updated = await prisma.store.update({
          where: { id },
          data: buildPosPinData(pin),
          include: { partner: true },
        });
        regenerated = true;
      }

      return res.json({
        ok: true,
        regenerated,
        store: sanitizeStore(updated),
        posCredentials: {
          username: updated.partner?.name || updated.partner?.slug || null,
          pin,
          updatedAt: updated.posPinUpdatedAt || null,
        },
      });
    } catch (error) {
      console.error("[GET /stores/:id/pos-credentials]", error);
      return res.status(500).json({ error: "pos_credentials_fetch_failed" });
    }
  });

  router.post("/", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    if (!partnerId) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const payload = buildStorePayload(req.body);

    if (!payload.storeName) {
      return res.status(400).json({ error: "storeName required" });
    }

    if (!payload.slug) {
      return res.status(400).json({ error: "slug required" });
    }

    if (req.body.active === true && !hasUsableStoreCoordinates(payload)) {
      return storeCoordinatesRequiredResponse(res);
    }

    try {
      await ensureStorePosCredentialColumns(prisma);

      const result = await prisma.$transaction(async (tx) => {
        const partner = await tx.partner.findUnique({
          where: { id: partnerId },
          select: { id: true, name: true },
        });

        if (!partner) {
          throw new Error("Partner not found");
        }

        const posPin = generateSixDigitPin();
        const store = await tx.store.create({
          data: {
            partnerId,
            ...payload,
            ...buildPosPinData(posPin),
          },
        });

        await zeroStockForNewStore(tx, store.id, partnerId);

        return { store, partner, posPin };
      });

      return res.json({
        ...sanitizeStore(result.store),
        posCredentials: {
          username: result.partner?.name || null,
          pin: result.posPin,
          updatedAt: result.store?.posPinUpdatedAt || null,
        },
      });
    } catch (error) {
      console.error("[POST /stores]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  router.post("/:id/pos-credentials/regenerate", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    try {
      await ensureStorePosCredentialColumns(prisma);

      const existing = await prisma.store.findUnique({
        where: { id },
        include: { partner: true },
      });

      if (!existing) {
        return res.status(404).json({ error: "Store not found" });
      }

      const posPin = generateSixDigitPin();
      const updated = await prisma.store.update({
        where: { id },
        data: buildPosPinData(posPin),
        include: { partner: true },
      });

      return res.json({
        ok: true,
        store: sanitizeStore(updated),
        posCredentials: {
          username: updated.partner?.name || updated.partner?.slug || null,
          pin: posPin,
          updatedAt: updated.posPinUpdatedAt || null,
        },
      });
    } catch (error) {
      console.error("[POST /stores/:id/pos-credentials/regenerate]", error);
      return res.status(500).json({ error: "pos_credentials_regenerate_failed" });
    }
  });

  router.patch("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    const payload = buildStorePayload(req.body);

    try {
      const existing = await prisma.store.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({ error: "Store not found" });
      }

      const nextActive =
        typeof req.body.active === "boolean" ? payload.active : existing.active;
      const nextData = {
        latitude: payload.latitude,
        longitude: payload.longitude,
      };

      if (nextActive && !hasUsableStoreCoordinates(nextData)) {
        nextData.active = false;
      } else {
        nextData.active = nextActive;
      }

      const updated = await prisma.store.update({
        where: { id },
        data: {
          storeName: payload.storeName || existing.storeName,
          slug: payload.slug || existing.slug,
          address: payload.address || existing.address,
          city: payload.city,
          zipCode: payload.zipCode,
          email: payload.email,
          tlf: payload.tlf,
          latitude: nextData.latitude,
          longitude: nextData.longitude,
          active: nextData.active,
          acceptingOrders:
            typeof req.body.acceptingOrders === "boolean"
              ? payload.acceptingOrders
              : existing.acceptingOrders,
          acceptsReservations: payload.acceptsReservations,
          reservationCapacity: payload.reservationCapacity,
        },
      });

      return res.json(sanitizeStore(updated));
    } catch (error) {
      console.error("[PATCH /stores/:id]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.storePizzaStock.deleteMany({ where: { storeId: id } });
        await tx.storeIngredientStock.deleteMany({ where: { storeId: id } });
        await tx.storeHours.deleteMany({ where: { storeId: id } });
        await tx.reservation.deleteMany({ where: { storeId: id } });
        await tx.sale.deleteMany({ where: { storeId: id } });
        await tx.store.delete({ where: { id } });
      });

      return res.json({ ok: true, id });
    } catch (error) {
      console.error("[DELETE /stores/:id]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  attachStorePublicMenu(router, prisma);

  return router;
}
