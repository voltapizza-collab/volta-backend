import express from "express";
import {
  constructStripeWebhookEvent,
  createOrderCheckoutSession,
  isStripeCheckoutConfigured,
  retrieveCheckoutSession,
} from "../services/stripe.js";
import { sendOrderPaidTrackingSms } from "../services/orderNotifications.js";
import { sendBoostPurchasedTrackingSms } from "../services/trackingNotifications.js";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const toCents = (value) => Math.round(roundMoney(value) * 100);
const PRISMA_CONNECTIVITY_CODES = new Set(["P1001", "P1002", "P1017"]);
const PROMO_LINE_SOURCES = new Set(["promo"]);
const PROMO_LINE_TYPES = new Set(["PROMO"]);
const TOP_DEAL_LINE_SOURCES = new Set(["discount", "direct_discount", "direct-discount", "top_deal", "topdeal", "offer"]);
const TOP_DEAL_LINE_TYPES = new Set(["DISCOUNT", "DIRECT_DISCOUNT", "DIRECT-DISCOUNT", "TOP_DEAL", "TOPDEAL", "OFFER"]);
const TZ = process.env.TIMEZONE || "Europe/Madrid";

const isPrismaConnectivityError = (error) => {
  const code = error?.code || error?.errorCode;
  const message = String(error?.message || error?.meta?.error || "");

  return (
    PRISMA_CONNECTIVITY_CODES.has(code) ||
    (code === "P2028" && message.includes("Transaction not found")) ||
    message.includes("Can't reach database server") ||
    message.includes("Server has closed the connection")
  );
};

const ensurePartnerMinimumPaymentColumn = async (prisma) => {
  try {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Partner` ADD COLUMN `minimumPaymentAmount` DOUBLE NULL DEFAULT 0"
    );
  } catch (error) {
    const message = String(error?.message || "");
    const metaMessage = String(error?.meta?.message || "");
    if (!message.includes("Duplicate column name") && !metaMessage.includes("Duplicate column name")) {
      throw error;
    }
  }
};

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};
const normalizeDigits = (value) => String(value || "").replace(/\D/g, "");
const normalizeEmail = (value) => {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};

const esBase9 = (phone) => {
  const digits = normalizeDigits(phone);
  if (digits.length === 9) return digits;
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  if (digits.length > 9) return digits.slice(-9);
  return null;
};

const toE164ES = (phone) => {
  const base9 = esBase9(phone);
  return base9 ? `+34${base9}` : null;
};

const getLineQty = (line) => {
  const qty = Number(line?.qty ?? line?.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
};

const asIdSet = (value) => {
  const list = asArray(value);
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

const nowInTZ = () => {
  const snapshot = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  return new Date(snapshot.replace(" ", "T"));
};

const minutesOfDay = (dateLike) => {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return date.getHours() * 60 + date.getMinutes();
};

const esDayToNum = (value) => {
  const map = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    "miércoles": 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    "sábado": 6,
  };
  const normalized = String(value || "").trim().toLowerCase();
  return normalized in map ? map[normalized] : null;
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

const isCouponLine = (line) => {
  const type = String(line?.type || "").toUpperCase();
  const source = String(line?.source || "").toLowerCase();
  return type === "COUPON" || source === "coupon";
};

const isIncentiveRewardLine = (line) => {
  const type = String(line?.type || "").toUpperCase();
  const source = String(line?.source || "").toLowerCase();
  return type === "INCENTIVE_REWARD" || source === "incentive_reward";
};

const isPromoLine = (line) => {
  const type = String(line?.type || "").trim().toUpperCase();
  const source = String(line?.source || "").trim().toLowerCase();
  const cartLineId = String(line?.cartLineId || "").trim().toLowerCase();
  return (
    Boolean(parsePositiveInt(line?.promoId)) ||
    asArray(line?.promoItems).length > 0 ||
    PROMO_LINE_TYPES.has(type) ||
    PROMO_LINE_SOURCES.has(source) ||
    cartLineId.startsWith("promo-")
  );
};

const isTopDealLine = (line) => {
  const type = String(line?.type || "").trim().toUpperCase();
  const source = String(line?.source || "").trim().toLowerCase();
  return Boolean(line?.directDiscount) || TOP_DEAL_LINE_TYPES.has(type) || TOP_DEAL_LINE_SOURCES.has(source);
};

const isBoostLine = (line) => {
  const type = String(line?.type || "").trim().toLowerCase();
  const source = String(line?.source || "").trim().toLowerCase();
  return type === "queue_boost" || source === "queue_boost";
};

const isDirectDiscountActive = (discount, reference) => {
  const current = reference.getTime();
  if (String(discount?.status || "ACTIVE").toUpperCase() !== "ACTIVE") return false;
  if (discount.activeFrom && new Date(discount.activeFrom).getTime() > current) return false;
  if (discount.expiresAt && new Date(discount.expiresAt).getTime() <= current) return false;

  const days = normalizeDaysActive(discount.daysActive);
  if (days.length && !days.includes(reference.getDay())) return false;

  if (discount.windowStart != null || discount.windowEnd != null) {
    const start = discount.windowStart == null ? 0 : Number(discount.windowStart);
    const end = discount.windowEnd == null ? 24 * 60 : Number(discount.windowEnd);
    const minutes = minutesOfDay(reference);

    if (start <= end && (minutes < start || minutes >= end)) return false;
    if (start > end && minutes < start && minutes >= end) return false;
  }

  return true;
};

const discountAppliesToStore = (discount, storeId) => {
  const storeIds = asIdSet(discount?.storeIds);
  return storeIds.size === 0 || storeIds.has(Number(storeId));
};

const discountAppliesToCartLine = (discount, line) => {
  const targetType = String(discount?.targetType || "").toUpperCase();
  const productIds = asIdSet(discount?.productIds);
  const pizzaId = parsePositiveInt(line?.pizzaId);

  if (pizzaId && productIds.has(pizzaId)) return true;
  if (targetType === "PRODUCT") return false;
  if (targetType !== "CATEGORY") return false;

  const categoryIds = asIdSet(discount?.categoryIds);
  const categoryId = parsePositiveInt(line?.categoryId);
  if (categoryId && categoryIds.has(categoryId)) return true;

  const categoryNames = asArray(discount?.categoryNames);
  const lineCategory = normalizeComparableText(line?.category);
  return Boolean(
    lineCategory &&
      categoryNames.some((categoryName) => normalizeComparableText(categoryName) === lineCategory)
  );
};

const lineHasActiveTopDeal = (line, activeTopDeals, storeId) =>
  activeTopDeals.some(
    (discount) => discountAppliesToStore(discount, storeId) && discountAppliesToCartLine(discount, line)
  );

const isCustomBuildLine = (line) => {
  const type = String(line?.type || "").toUpperCase();
  const cartLineId = String(line?.cartLineId || "");
  return type === "CUSTOM_BUILD" || cartLineId.startsWith("custom-");
};

const sanitizeCustomIngredient = (ingredient) => ({
  ingredientId: parsePositiveInt(ingredient?.ingredientId ?? ingredient?.id),
  name: String(ingredient?.name || ingredient?.label || "Ingrediente").trim().slice(0, 120),
  category: String(ingredient?.category || "OTROS").trim().slice(0, 80),
  placement: String(ingredient?.placement || "").trim().slice(0, 40),
  quantity: String(ingredient?.quantity || "SIMPLE").trim().slice(0, 40),
  placementLabel: String(ingredient?.placementLabel || "").trim().slice(0, 80),
  quantityLabel: String(ingredient?.quantityLabel || "").trim().slice(0, 80),
  label: String(ingredient?.label || "").trim().slice(0, 180),
});

const sanitizeCustomDetails = (details, fallbackIngredients = []) => {
  const sourceIngredients = asArray(details?.ingredients).length
    ? asArray(details.ingredients)
    : fallbackIngredients;
  const ingredients = sourceIngredients.map(sanitizeCustomIngredient);

  if (!ingredients.length && (!details || typeof details !== "object")) {
    return null;
  }

  return {
    categoryName: String(details?.categoryName || "").trim().slice(0, 120),
    baseProductName: String(details?.baseProductName || "").trim().slice(0, 160),
    summary: String(details?.summary || "").trim().slice(0, 1000),
    ingredients,
  };
};

const sanitizeTrendingPricing = (value) => {
  if (!value || typeof value !== "object") return null;

  const basePrice = roundMoney(value.basePrice);
  const chargedPrice = roundMoney(value.chargedPrice);
  const rawBand = Number(value.band);
  const band = Number.isFinite(rawBand) && rawBand > 0 ? roundMoney(rawBand) : 0.5;
  const adjustment = roundMoney(value.adjustment);
  const adjustmentTotal = roundMoney(value.adjustmentTotal);
  const safeAdjustment =
    Math.abs(adjustment) <= band + 0.001
      ? adjustment
      : Math.max(-band, Math.min(band, adjustment));

  return {
    mode: String(value.mode || "FLOATING_BAND").trim().slice(0, 60),
    rank: parsePositiveInt(value.rank),
    sourceCategoryId: parsePositiveInt(value.sourceCategoryId),
    sourceCategory: String(value.sourceCategory || "").trim().slice(0, 120),
    band,
    size: String(value.size || "").trim().slice(0, 80),
    basePrice,
    chargedPrice,
    adjustment: roundMoney(safeAdjustment),
    adjustmentTotal,
    floorPrice: roundMoney(value.floorPrice),
    ceilingPrice: roundMoney(value.ceilingPrice),
    label: String(value.label || "").trim().slice(0, 60),
    lockedAt: value.lockedAt ? String(value.lockedAt).trim().slice(0, 80) : null,
  };
};

const getLineTotal = (line) => {
  if (isIncentiveRewardLine(line)) return 0;
  if (Number.isFinite(Number(line?.subtotal))) return roundMoney(line.subtotal);
  return roundMoney(Number(line?.price || 0) * getLineQty(line));
};

const sanitizeLine = (line, index) => ({
  cartLineId: String(line?.cartLineId || `line-${index}`),
  pizzaId: parsePositiveInt(line?.pizzaId),
  name: String(line?.name || line?.title || "Producto").trim().slice(0, 160),
  leftPizzaId: parsePositiveInt(line?.leftPizzaId),
  rightPizzaId: parsePositiveInt(line?.rightPizzaId),
  leftName: line?.leftName ? String(line.leftName).trim().slice(0, 160) : null,
  rightName: line?.rightName ? String(line.rightName).trim().slice(0, 160) : null,
  categoryId: parsePositiveInt(line?.categoryId),
  category: String(line?.category || "").trim().slice(0, 120),
  size: String(line?.size || "").trim().slice(0, 80),
  qty: getLineQty(line),
  price: roundMoney(line?.price),
  subtotal: getLineTotal(line),
  type: line?.type ? String(line.type).trim().slice(0, 60) : null,
  source: line?.source ? String(line.source).trim().slice(0, 60) : null,
  extras: asArray(line?.extras),
  ingredients: asArray(line?.ingredients),
  allergens: asArray(line?.allergens),
  customDetails: sanitizeCustomDetails(line?.customDetails, asArray(line?.ingredients)),
  customMeta: line?.customMeta && typeof line.customMeta === "object" ? line.customMeta : null,
  halfMeta: line?.halfMeta && typeof line.halfMeta === "object" ? line.halfMeta : null,
  promoId: parsePositiveInt(line?.promoId),
  promoItems: asArray(line?.promoItems),
  couponId: parsePositiveInt(line?.couponId),
  couponCode: line?.couponCode ? String(line.couponCode).trim().toUpperCase() : null,
  coupon: line?.coupon && typeof line.coupon === "object" ? line.coupon : null,
  directDiscount: line?.directDiscount || null,
  trendingPricing: sanitizeTrendingPricing(line?.trendingPricing),
  incentiveId: parsePositiveInt(line?.incentiveId),
  rewardPizzaId: parsePositiveInt(line?.rewardPizzaId),
  boost: line?.boost && typeof line.boost === "object" ? line.boost : null,
});

export const getEligibleCouponSubtotal = (lines, { activeTopDeals = [], storeId = null } = {}) =>
  lines
    .filter((line) => {
      if (isCouponLine(line) || isIncentiveRewardLine(line)) return false;
      if (isBoostLine(line) || isPromoLine(line) || isTopDealLine(line)) return false;
      if (storeId && lineHasActiveTopDeal(line, activeTopDeals, storeId)) return false;
      return true;
    })
    .reduce((sum, line) => sum + Math.max(0, getLineTotal(line)), 0);

const calculateCouponDiscount = (coupon, eligibleSubtotal) => {
  const base = Math.max(0, roundMoney(eligibleSubtotal));
  if (base <= 0) return 0;

  if (coupon.kind === "AMOUNT") {
    return roundMoney(Math.min(Number(coupon.amount || 0), base));
  }

  if (coupon.kind === "PERCENT") {
    const raw = roundMoney((base * Number(coupon.percent || 0)) / 100);
    const maxAmount = coupon.maxAmount == null ? null : Number(coupon.maxAmount);
    return roundMoney(maxAmount == null ? raw : Math.min(raw, maxAmount));
  }

  return 0;
};

const buildReturnUrl = (req, status, fallbackPath = "/", extraParams = {}) => {
  const origin = String(req.body.frontendOrigin || process.env.FRONT_BASE_URL || process.env.PUBLIC_FRONTEND_URL || "").replace(/\/$/, "");
  const path = String(req.body.returnPath || fallbackPath || "/");
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ payment: status });
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });
  return `${origin}${path}${separator}${params.toString()}&session_id={CHECKOUT_SESSION_ID}`;
};

const genSaleCode = async (prisma) => {
  let code;
  do {
    code = `WEB-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
  } while (await prisma.sale.findUnique({ where: { code } }));
  return code;
};

const genCustomerCode = async (prisma) => {
  let code;
  do {
    code = `CUS-${Math.floor(10000 + Math.random() * 90000)}`;
  } while (await prisma.customer.findUnique({ where: { code } }));
  return code;
};

const resolveDeliveryMethod = (value) => {
  const method = String(value || "").trim().toUpperCase();
  if (["PICKUP", "COURIER", "MARKETPLACE", "OTHER"].includes(method)) return method;
  return "PICKUP";
};

const extractZipCode = (value) => {
  const match = String(value || "").match(/\b(\d{5})\b/);
  return match ? match[1] : null;
};

const buildStripeCheckoutEmail = ({ customer, phone, saleId }) => {
  const providedEmail = normalizeEmail(customer?.email);
  if (providedEmail) return providedEmail;

  const digits = normalizeDigits(phone || customer?.phone);
  const fallbackDomain = String(
    process.env.STRIPE_CHECKOUT_FALLBACK_EMAIL_DOMAIN || "mycrushpizza.test"
  )
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  const fallbackLocal = digits || `order-${saleId || Date.now()}`;

  return `${fallbackLocal}@${fallbackDomain}`;
};

const isUsableCoordinatePair = (lat, lng) => {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  return Number.isFinite(safeLat) && Number.isFinite(safeLng) && !(safeLat === 0 && safeLng === 0);
};

const resolveCheckoutCustomer = async (tx, { partnerId, customer, delivery, store }) => {
  const customerId = parsePositiveInt(customer?.id || customer?.customerId);
  const rawName = String(customer?.name || "").trim();
  const email = normalizeEmail(customer?.email);
  const normalizedPhone = toE164ES(customer?.phone);
  const base9 = esBase9(customer?.phone);
  const address = String(
    customer?.address_1 ||
      customer?.address ||
      delivery?.address ||
      (delivery?.method === "PICKUP" && normalizedPhone ? `(PICKUP) ${normalizedPhone}` : "")
  ).trim();

  if (customerId) {
    const existing = await tx.customer.findFirst({
      where: { id: customerId, partnerId },
    });

    if (!existing) return null;

    const updateData = {
      ...(rawName && !existing.name ? { name: rawName } : {}),
      ...(normalizedPhone && !existing.phone ? { phone: normalizedPhone } : {}),
      ...(email && !existing.email ? { email } : {}),
      ...(address && (!existing.address_1 || /^\(PICKUP\)/i.test(existing.address_1))
        ? {
            address_1: address,
            zipCode: extractZipCode(address) || (delivery?.method === "PICKUP" ? String(store?.zipCode || "").trim() || null : null),
          }
        : {}),
      ...(isUsableCoordinatePair(delivery?.lat, delivery?.lng)
        ? { lat: Number(delivery.lat), lng: Number(delivery.lng) }
        : delivery?.method === "PICKUP" && isUsableCoordinatePair(store?.latitude, store?.longitude)
          ? { lat: Number(store.latitude), lng: Number(store.longitude) }
          : {}),
    };

    return Object.keys(updateData).length
      ? tx.customer.update({ where: { id: existing.id }, data: updateData })
      : existing;
  }

  if (!rawName || !normalizedPhone || !base9) return null;

  const existing = await tx.customer.findFirst({
    where: {
      partnerId,
      phone: { contains: base9 },
    },
  });

  const storeZipCode = String(store?.zipCode || "").trim();
  const zipCode = extractZipCode(address) || (delivery?.method === "PICKUP" ? storeZipCode : null);
  const geo = {
    ...(isUsableCoordinatePair(delivery?.lat, delivery?.lng)
      ? { lat: Number(delivery.lat), lng: Number(delivery.lng) }
      : delivery?.method === "PICKUP" && isUsableCoordinatePair(store?.latitude, store?.longitude)
        ? { lat: Number(store.latitude), lng: Number(store.longitude) }
        : {}),
  };

  if (existing) {
    return tx.customer.update({
      where: { id: existing.id },
      data: {
        name: rawName || existing.name,
        phone: normalizedPhone,
        ...(email ? { email } : {}),
        ...(address ? { address_1: address } : {}),
        ...(zipCode ? { zipCode } : {}),
        ...geo,
      },
    });
  }

  return tx.customer.create({
    data: {
      partnerId,
      code: await genCustomerCode(tx),
      origin: "PHONE",
      name: rawName,
      phone: normalizedPhone,
      email: email || null,
      address_1: address || `(PICKUP) ${normalizedPhone}`,
      zipCode,
      ...geo,
    },
  });
};

const createCouponRedemptionsForSale = async (tx, sale) => {
  const lines = asArray(sale.products);
  const couponLines = lines.filter((line) => isCouponLine(line) && line.couponCode);

  for (const line of couponLines) {
    const existing = await tx.couponRedemption.findFirst({
      where: {
        saleId: sale.id,
        couponCode: line.couponCode,
      },
      select: { id: true },
    });

    if (existing) continue;

    const coupon = await tx.coupon.findFirst({
      where: {
        partnerId: sale.partnerId,
        code: line.couponCode,
      },
    });

    if (!coupon) continue;

    await tx.couponRedemption.create({
      data: {
        partnerId: sale.partnerId,
        couponId: coupon.id,
        saleId: sale.id,
        customerId: sale.customerId || null,
        storeId: sale.storeId,
        gameId: coupon.gameId || null,
        couponCode: coupon.code,
        acquisition: coupon.acquisition || null,
        channel: coupon.channel || null,
        campaign: coupon.campaign || null,
        kind: coupon.kind,
        variant: coupon.variant,
        percentApplied: coupon.percent || null,
        amountApplied: coupon.amount || null,
        discountValue: String(Math.abs(Number(line.subtotal || line.discount || 0)).toFixed(2)),
      },
    });

    const nextUsedCount = Number(coupon.usedCount || 0) + 1;
    const usageLimit = Number(coupon.usageLimit || 1);
    await tx.coupon.update({
      where: { id: coupon.id },
      data: {
        usedCount: nextUsedCount,
        usedAt: new Date(),
        status: nextUsedCount >= usageLimit ? "USED" : coupon.status,
      },
    });
  }
};

export default function checkoutRoutes(prisma) {
  const router = express.Router();

  router.post("/session", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    const storeId = parsePositiveInt(req.body.storeId);
    const rawLines = asArray(req.body.cart);
    const currency = String(req.body.currency || "EUR").trim().toUpperCase();

    if (!partnerId || !storeId || !rawLines.length) {
      return res.status(400).json({ ok: false, error: "bad_checkout_payload" });
    }

    if (!isStripeCheckoutConfigured()) {
      return res.status(503).json({ ok: false, error: "stripe_not_configured" });
    }

    try {
      await ensurePartnerMinimumPaymentColumn(prisma);

      const [partner, store] = await Promise.all([
        prisma.partner.findUnique({
          where: { id: partnerId },
          select: { id: true, name: true, slug: true, currency: true, minimumPaymentAmount: true },
        }),
        prisma.store.findFirst({
          where: { id: storeId, partnerId, active: true },
          select: {
            id: true,
            storeName: true,
            slug: true,
            address: true,
            city: true,
            zipCode: true,
            latitude: true,
            longitude: true,
          },
        }),
      ]);

      if (!partner || !store) {
        return res.status(404).json({ ok: false, error: "store_not_found" });
      }

      let lines = rawLines.map(sanitizeLine);
      const incompleteCustomLine = lines.find(
        (line) =>
          isCustomBuildLine(line) &&
          !asArray(line.ingredients).length &&
          !asArray(line.customDetails?.ingredients).length
      );

      if (incompleteCustomLine) {
        return res.status(400).json({
          ok: false,
          error: "custom_build_missing_ingredients",
          line: incompleteCustomLine.name || "Personalizada",
        });
      }

      const activeTopDeals = (
        await prisma.directDiscount.findMany({
          where: {
            partnerId,
            status: "ACTIVE",
            AND: [
              {
                OR: [
                  { activeFrom: null },
                  { activeFrom: { lte: new Date() } },
                ],
              },
              {
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            ],
          },
        })
      ).filter((discount) => isDirectDiscountActive(discount, nowInTZ()));

      const couponLine = lines.find(isCouponLine);
      const eligibleSubtotal = getEligibleCouponSubtotal(lines, { activeTopDeals, storeId });

      if (couponLine?.couponCode) {
        const coupon = await prisma.coupon.findFirst({
          where: {
            partnerId,
            code: couponLine.couponCode,
            status: "ACTIVE",
          },
        });

        if (!coupon) {
          return res.status(409).json({ ok: false, error: "coupon_not_available" });
        }

        const expectedDiscount = calculateCouponDiscount(coupon, eligibleSubtotal);
        if (expectedDiscount <= 0) {
          return res.status(409).json({ ok: false, error: "coupon_not_applicable" });
        }

        lines = lines.map((line) =>
          isCouponLine(line)
            ? {
                ...line,
                couponId: coupon.id,
                couponCode: coupon.code,
                name: `Cupon ${coupon.code}`,
                subtotal: -expectedDiscount,
                price: -expectedDiscount,
                discount: expectedDiscount,
              }
            : line
        );
      }

      const totalProducts = roundMoney(
        lines
          .filter((line) => !isCouponLine(line))
          .reduce((sum, line) => sum + Math.max(0, getLineTotal(line)), 0)
      );
      const discounts = roundMoney(
        lines
          .filter(isCouponLine)
          .reduce((sum, line) => sum + Math.abs(getLineTotal(line)), 0)
      );
      const total = roundMoney(Math.max(0, totalProducts - discounts));
      const amountCents = toCents(total);
      const minimumPaymentAmount = Math.max(0, Number(partner.minimumPaymentAmount || 0));

      if (minimumPaymentAmount > 0 && total < minimumPaymentAmount) {
        return res.status(400).json({
          ok: false,
          error: "minimum_payment_not_met",
          minimumPaymentAmount,
          total,
        });
      }

      if (amountCents < 50) {
        return res.status(400).json({ ok: false, error: "amount_too_low" });
      }

      const delivery = req.body.delivery && typeof req.body.delivery === "object" ? req.body.delivery : {};
      const sanitizedDelivery = {
        method: resolveDeliveryMethod(delivery.method),
        address: delivery.address ? String(delivery.address).trim() : "",
        addressLine2: delivery.addressLine2 ? String(delivery.addressLine2).trim() : "",
        lat: Number.isFinite(Number(delivery.lat)) ? Number(delivery.lat) : null,
        lng: Number.isFinite(Number(delivery.lng)) ? Number(delivery.lng) : null,
      };
      const fullDeliveryAddress = [sanitizedDelivery.address, sanitizedDelivery.addressLine2]
        .filter(Boolean)
        .join(", ");
      const scheduledFor = req.body.scheduledFor ? new Date(req.body.scheduledFor) : null;
      const customerInput = req.body.customer && typeof req.body.customer === "object" ? req.body.customer : {};
      const sale = await prisma.$transaction(async (tx) => {
        const customer = await resolveCheckoutCustomer(tx, {
          partnerId,
          customer: customerInput,
          delivery: {
            ...sanitizedDelivery,
            address: fullDeliveryAddress || sanitizedDelivery.address,
          },
          store,
        });

        if (!customer) {
          const error = new Error("customer_profile_required");
          error.status = 400;
          throw error;
        }

        const checkoutEmail = buildStripeCheckoutEmail({
          customer: {
            ...customerInput,
            email: customer.email || customerInput.email,
          },
          phone: customer.phone || customerInput.phone,
          saleId: customer.id,
        });

        return tx.sale.create({
          data: {
            code: await genSaleCode(tx),
            partnerId,
            storeId,
            customerId: customer.id,
            type: "WEB_ORDER",
            delivery: sanitizedDelivery.method,
            customerData: {
              source: "storefront",
              name: customer.name || String(customerInput.name || "").trim(),
              phone: customer.phone || toE164ES(customerInput.phone),
              email: checkoutEmail,
              address_1: fullDeliveryAddress || sanitizedDelivery.address || customer.address_1 || "",
              zipCode: customer.zipCode || extractZipCode(sanitizedDelivery.address),
              customerId: customer.id,
              customerCode: customer.code,
              delivery: sanitizedDelivery,
              scheduledFor: scheduledFor && !Number.isNaN(scheduledFor.getTime()) ? scheduledFor.toISOString() : null,
            },
            products: lines,
            extras: [],
            totalProducts,
            discounts,
            total,
            status: "AWAITING_PAYMENT",
            channel: "WEB",
            currency,
            address_1: fullDeliveryAddress || sanitizedDelivery.address || customer.address_1 || null,
            lat: sanitizedDelivery.lat,
            lng: sanitizedDelivery.lng,
            incentiveId: lines.find((line) => line.incentiveId)?.incentiveId || null,
            incentiveAmount: Math.abs(lines.find(isIncentiveRewardLine)?.subtotal || 0) || 0,
            boostActive: lines.some((line) => line.source === "queue_boost"),
            boostTargetPosition: lines.find((line) => line.source === "queue_boost")?.boost?.targetPosition || null,
            boostOriginalPosition: lines.find((line) => line.source === "queue_boost")?.boost?.currentPosition || null,
            boostQueueCredit: lines.find((line) => line.source === "queue_boost")?.boost?.positionsToJump || 0,
            boostAmount: lines.find((line) => line.source === "queue_boost")?.subtotal
              ? String(Math.abs(Number(lines.find((line) => line.source === "queue_boost").subtotal)).toFixed(2))
              : null,
            boostMeta: lines.find((line) => line.source === "queue_boost")?.boost || null,
          },
        });
      });

      const session = await createOrderCheckoutSession({
        sale,
        partner,
        store,
        amountCents,
        currency,
        successUrl: buildReturnUrl(req, "success", `/${partner.slug}/${store.slug}`, {
          order_code: sale.code,
        }),
        cancelUrl: buildReturnUrl(req, "cancel", `/${partner.slug}/${store.slug}`),
      });

      if (!session?.url) {
        return res.status(502).json({ ok: false, error: "stripe_session_url_missing" });
      }

      await prisma.sale.update({
        where: { id: sale.id },
        data: {
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.payment_intent || null,
        },
      });

      return res.json({
        ok: true,
        saleId: sale.id,
        customerId: sale.customerId,
        orderCode: sale.code,
        sessionId: session.id,
        url: session.url,
        total,
        currency,
      });
    } catch (error) {
      console.error("[checkout.session] error:", error);
      if (error?.status === 400 && error?.message === "customer_profile_required") {
        return res.status(400).json({ ok: false, error: "customer_profile_required" });
      }
      if (isPrismaConnectivityError(error)) {
        return res.status(503).json({ ok: false, error: "database_unavailable" });
      }
      return res.status(500).json({ ok: false, error: "checkout_failed" });
    }
  });

  const markPaidFromStripeSession = async (session) => {
    const metadata = session.metadata || {};

    if (metadata.purpose !== "order_checkout") {
      const error = new Error("not_order_checkout");
      error.status = 400;
      throw error;
    }

    if (session.payment_status && session.payment_status !== "paid") {
      const error = new Error("payment_not_paid");
      error.status = 409;
      throw error;
    }

    const saleId = parsePositiveInt(metadata.saleId);
    if (!saleId) {
      const error = new Error("bad_order_metadata");
      error.status = 400;
      throw error;
    }

    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) {
        const error = new Error("sale_not_found");
        error.status = 404;
        throw error;
      }

      if (sale.status === "PAID") {
        return { sale, shouldNotify: false };
      }

      const paidSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: "PAID",
          stripeCheckoutSessionId: session.id || sale.stripeCheckoutSessionId,
          stripePaymentIntentId: session.payment_intent || sale.stripePaymentIntentId,
          ...(sale.boostActive && !sale.boostPaidAt ? { boostPaidAt: new Date() } : {}),
        },
      });

      await createCouponRedemptionsForSale(tx, paidSale);
      return { sale: paidSale, shouldNotify: true };
    });

    if (result.shouldNotify) {
      sendOrderPaidTrackingSms(prisma, result.sale)
        .then((sms) => {
          if (!sms.ok) console.warn("[checkout.order-paid-sms]", sms);
        })
        .catch((error) => console.error("[checkout.order-paid-sms] error:", error));
    }

    return result;
  };

  const markBoostPaidFromStripeSession = async (session) => {
    const metadata = session.metadata || {};

    if (metadata.purpose !== "boost_checkout") {
      const error = new Error("not_boost_checkout");
      error.status = 400;
      throw error;
    }

    if (session.payment_status && session.payment_status !== "paid") {
      const error = new Error("payment_not_paid");
      error.status = 409;
      throw error;
    }

    const saleId = parsePositiveInt(metadata.saleId);
    if (!saleId) {
      const error = new Error("bad_boost_metadata");
      error.status = 400;
      throw error;
    }

    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) {
        const error = new Error("sale_not_found");
        error.status = 404;
        throw error;
      }

      if (sale.processed) {
        const error = new Error("order_already_ready");
        error.status = 409;
        throw error;
      }

      if (sale.boostActive && sale.boostPaidAt) {
        return { sale, alreadyApplied: true };
      }

      const targetPosition = parsePositiveInt(metadata.targetPosition) || 1;
      const currentPosition = parsePositiveInt(metadata.currentPosition) || null;
      const positionsToJump = parsePositiveInt(metadata.positionsToJump) || 0;
      const amountCents = parsePositiveInt(metadata.amountCents) || 0;
      const amount = roundMoney(amountCents / 100);

      const updated = await tx.sale.update({
        where: { id: sale.id },
        data: {
          boostActive: true,
          boostTargetPosition: targetPosition,
          boostOriginalPosition: sale.boostOriginalPosition || currentPosition,
          boostQueueCredit: positionsToJump,
          boostAmount: amount ? String(amount.toFixed(2)) : sale.boostAmount,
          boostPaidAt: new Date(),
          boostMeta: {
            ...(sale.boostMeta && typeof sale.boostMeta === "object" ? sale.boostMeta : {}),
            source: "tracking",
            paymentMode: "stripe_boost_checkout",
            stripeCheckoutSessionId: session.id || null,
            stripePaymentIntentId: session.payment_intent || null,
            quotedAt: new Date().toISOString(),
            unitPrice: Number(metadata.unitPrice || 0),
            voltaSharePercent: Number(metadata.voltaSharePercent || 0),
            partnerSharePercent: Number(metadata.partnerSharePercent || 0),
            previousTargetPosition: sale.boostTargetPosition || null,
          },
        },
      });

      return { sale: updated, alreadyApplied: false };
    });
  };

  const sendBoostPurchasedNotification = async (sale) => {
    const boostedSale = await prisma.sale.findUnique({
      where: { id: sale.id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        store: {
          select: {
            id: true,
            partnerId: true,
            storeName: true,
            partner: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!boostedSale) {
      return { ok: false, skipped: true, reason: "sale_not_found" };
    }

    if (boostedSale.partnerId) {
      const partnerRows = await prisma.$queryRawUnsafe(
        "SELECT trackingNotificationSettings FROM Partner WHERE id = ?",
        boostedSale.partnerId
      );
      boostedSale.store.partner = {
        ...(boostedSale.store.partner || {}),
        trackingNotificationSettings:
          partnerRows?.[0]?.trackingNotificationSettings || null,
      };
    }

    return sendBoostPurchasedTrackingSms(prisma, { sale: boostedSale });
  };

  router.post("/session/confirm", async (req, res) => {
    const sessionId = String(req.body?.sessionId || req.body?.session_id || "").trim();

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "stripe_session_id_required" });
    }

    try {
      const session = await retrieveCheckoutSession(sessionId);
      if (session.metadata?.purpose === "boost_checkout") {
        const result = await markBoostPaidFromStripeSession(session);

        if (!result.alreadyApplied) {
          sendBoostPurchasedNotification(result.sale)
            .then((sms) => {
              if (!sms.ok) console.warn("[checkout.boost-purchased-sms]", sms);
            })
            .catch((error) => console.error("[checkout.boost-purchased-sms] error:", error));
        }

        return res.json({
          ok: true,
          status: "BOOST_PAID",
          saleId: result.sale.id,
          orderCode: result.sale.code,
          alreadyApplied: result.alreadyApplied,
        });
      }

      const result = await markPaidFromStripeSession(session);

      return res.json({
        ok: true,
        status: result.sale.status,
        saleId: result.sale.id,
        orderCode: result.sale.code,
        notified: result.shouldNotify,
      });
    } catch (error) {
      console.error("[checkout.session.confirm] error:", error);
      return res.status(error.status || 500).json({
        ok: false,
        error: error.message || "confirm_failed",
      });
    }
  });

  router.post("/stripe/webhook", async (req, res) => {
    let event;

    try {
      const payload = req.rawBody || JSON.stringify(req.body || {});
      event = constructStripeWebhookEvent(payload, req.get("stripe-signature"));
    } catch (error) {
      console.error("[checkout.stripe-webhook] signature error:", error.message);
      return res.status(400).json({ ok: false, error: "bad_stripe_signature" });
    }

    if (event.type !== "checkout.session.completed") {
      return res.json({ ok: true, ignored: true });
    }

    const session = event.data?.object || {};

    try {
      if (session.metadata?.purpose === "boost_checkout") {
        const result = await markBoostPaidFromStripeSession(session);

        if (!result.alreadyApplied) {
          sendBoostPurchasedNotification(result.sale)
            .then((sms) => {
              if (!sms.ok) console.warn("[checkout.boost-purchased-sms]", sms);
            })
            .catch((error) => console.error("[checkout.boost-purchased-sms] error:", error));
        }

        return res.json({
          ok: true,
          status: "boost_paid",
          saleId: result.sale.id,
          orderCode: result.sale.code,
        });
      }

      const result = await markPaidFromStripeSession(session);

      return res.json({
        ok: true,
        status: "order_paid",
        saleId: result.sale.id,
        orderCode: result.sale.code,
      });
    } catch (error) {
      if (["not_order_checkout", "not_boost_checkout", "payment_not_paid"].includes(error.message)) {
        return res.json({ ok: true, ignored: true, status: error.message });
      }
      console.error("[checkout.stripe-webhook] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  return router;
}
