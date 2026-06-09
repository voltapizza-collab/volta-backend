import crypto from "crypto";
import { reserveSmsCreditForMessage, refundSmsCreditForMessage } from "./smsCredits.js";
import { isPartnerSmsServiceEnabled } from "./smsNotificationSettings.js";
import { estimateSmsParts, normalizeE164Phone, sendTelnyxSms } from "./telnyx.js";

const REVIEW_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  RESPONDED: "RESPONDED",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
};

const frontendBaseUrl = () =>
  String(
    process.env.PUBLIC_FRONTEND_URL ||
      process.env.FRONTEND_URL ||
      process.env.STOREFRONT_URL ||
      process.env.APP_URL ||
      "https://voltapizza.com"
  )
    .trim()
    .replace(/\/$/, "");

export const buildProductReviewUrl = (request) =>
  `${frontendBaseUrl()}/review/${encodeURIComponent(request.token)}`;

const parseMaybeJson = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const asArray = (value) => {
  const first = parseMaybeJson(value, []);
  const second = parseMaybeJson(first, []);
  return Array.isArray(second) ? second : [];
};

const asObject = (value) => {
  const parsed = parseMaybeJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

const positiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const cleanName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);

const getLineQty = (line) => Math.max(1, Math.trunc(Number(line?.quantity || line?.qty || 1)));

const NON_REVIEWABLE_SOURCES = new Set([
  "coupon",
  "discount",
  "direct_discount",
  "direct-discount",
  "top_deal",
  "topdeal",
  "offer",
  "queue_boost",
  "incentive_reward",
  "delivery",
  "shipping",
  "service",
]);

const NON_REVIEWABLE_TYPES = new Set([
  "COUPON",
  "DISCOUNT",
  "DIRECT_DISCOUNT",
  "TOP_DEAL",
  "OFFER",
  "QUEUE_BOOST",
  "BOOST",
  "INCENTIVE_REWARD",
  "DELIVERY",
  "SHIPPING",
  "SERVICE",
  "DRINK",
  "BEBIDA",
]);

const NON_REVIEWABLE_NAME_PATTERNS = [
  /^cupon\b/i,
  /^cup[oó]n\b/i,
  /^coupon\b/i,
  /^descuento\b/i,
  /^discount\b/i,
  /\bbebida\b/i,
  /\bdrink\b/i,
  /\brefresco\b/i,
  /\bcoca[-\s]?cola\b/i,
  /\baquarius\b/i,
  /\bfanta\b/i,
  /\bwater\b/i,
  /\bagua\b/i,
  /\bcerveza\b/i,
];

const lineAmount = (line) => {
  const candidates = [line?.subtotal, line?.lineTotal, line?.total, line?.price, line?.unitPrice];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const isReviewableProductLine = (line = {}) => {
  const source = String(line?.source || "").trim().toLowerCase();
  const type = String(line?.type || line?.categoryType || "").trim().toUpperCase();
  const name = cleanName(line?.name || line?.pizzaName || line?.title);

  if (!name) return false;
  if (NON_REVIEWABLE_SOURCES.has(source)) return false;
  if (NON_REVIEWABLE_TYPES.has(type)) return false;
  if (line?.couponId || line?.couponCode || line?.coupon) return false;
  if (line?.boost || line?.discount || line?.directDiscount) return false;
  if (NON_REVIEWABLE_NAME_PATTERNS.some((pattern) => pattern.test(name))) return false;

  const amount = lineAmount(line);
  if (amount != null && amount <= 0) return false;

  return true;
};

export const isReviewableProductName = (name = "") =>
  Boolean(cleanName(name)) && !NON_REVIEWABLE_NAME_PATTERNS.some((pattern) => pattern.test(cleanName(name)));

const pushReviewItem = (items, line, lineIndex, nestedIndex = null) => {
  const productId = positiveInt(line?.pizzaId ?? line?.productId ?? line?.id ?? line?.rewardPizzaId);
  const name = cleanName(line?.name || line?.pizzaName || line?.title);

  if (!isReviewableProductLine(line)) return;

  const size = String(line?.size || line?.selectedSize || "").trim();
  const keyParts = [
    productId || "custom",
    name.toLowerCase(),
    size || "size",
    lineIndex,
    nestedIndex == null ? "line" : nestedIndex,
  ];

  items.push({
    lineKey: keyParts.join(":").replace(/[^a-z0-9:_-]+/gi, "-").slice(0, 180),
    productId,
    name,
    image: line?.image || line?.photo || null,
    size,
    quantity: getLineQty(line),
  });
};

export const getReviewItemsFromSale = (sale) => {
  const products = asArray(sale?.products);
  const items = [];

  products.forEach((line, lineIndex) => {
    const promoItems = asArray(line?.promoItems);
    if (promoItems.length) {
      promoItems.forEach((promoItem, nestedIndex) => {
        pushReviewItem(items, promoItem, lineIndex, nestedIndex);
      });
      return;
    }

    pushReviewItem(items, line, lineIndex);
  });

  return [...new Map(items.map((item) => [item.lineKey, item])).values()];
};

const getCustomerPhone = (sale) => {
  const data = asObject(sale?.customerData);
  return normalizeE164Phone(data.phone || sale?.customer?.phone || sale?.customerPhone);
};

const getCustomerName = (sale) => {
  const data = asObject(sale?.customerData);
  return cleanName(data.name || sale?.customer?.name).split(/\s+/)[0] || "cliente";
};

const generateToken = async (prisma) => {
  let token = "";

  do {
    token = crypto.randomBytes(18).toString("base64url");
  } while (await prisma.productReviewRequest.findUnique({ where: { token } }));

  return token;
};

const reviewDelayMinutes = () => {
  const value = Number(process.env.PRODUCT_REVIEW_DELAY_MINUTES || 60);
  return Number.isFinite(value) && value >= 0 ? value : 60;
};

export async function createProductReviewRequestForSale(prisma, sale) {
  if (!sale?.id || sale.status === "CANCELED") {
    return { ok: false, skipped: true, reason: "bad_sale" };
  }

  const items = getReviewItemsFromSale(sale);
  if (!items.length) {
    return { ok: false, skipped: true, reason: "no_reviewable_products" };
  }

  const existing = await prisma.productReviewRequest.findUnique({
    where: { saleId: sale.id },
  });

  if (existing) {
    return { ok: true, request: existing, alreadyExists: true, reviewUrl: buildProductReviewUrl(existing) };
  }

  const sendAfter = new Date(Date.now() + reviewDelayMinutes() * 60 * 1000);
  const token = await generateToken(prisma);
  const customerPhone = getCustomerPhone(sale);

  const request = await prisma.productReviewRequest.create({
    data: {
      token,
      saleId: sale.id,
      partnerId: sale.partnerId,
      storeId: sale.storeId,
      customerId: sale.customerId || null,
      customerPhone,
      sendAfter,
      status: customerPhone ? REVIEW_STATUS.PENDING : REVIEW_STATUS.SKIPPED,
      messageStatus: customerPhone ? null : "missing_phone",
    },
  });

  return { ok: true, request, reviewUrl: buildProductReviewUrl(request) };
}

export async function sendProductReviewRequestSms(prisma, request) {
  const loaded =
    request?.sale
      ? request
      : await prisma.productReviewRequest.findUnique({
          where: { id: request.id },
          include: {
            sale: {
              include: {
                partner: { select: { id: true, name: true } },
                store: { select: { id: true, storeName: true } },
                customer: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        });

  if (!loaded || loaded.status === REVIEW_STATUS.RESPONDED) {
    return { ok: false, skipped: true, reason: "not_sendable" };
  }

  const sale = loaded.sale;
  const serviceEnabled = await isPartnerSmsServiceEnabled(prisma, {
    partnerId: loaded.partnerId,
    storeId: sale?.storeId,
    serviceId: "customerReviewRequest",
  });
  if (!serviceEnabled) {
    await prisma.productReviewRequest.update({
      where: { id: loaded.id },
      data: { status: REVIEW_STATUS.SKIPPED, messageStatus: "sms_service_disabled" },
    });
    return { ok: false, skipped: true, reason: "sms_service_disabled" };
  }

  const to = loaded.customerPhone || getCustomerPhone(sale);
  if (!to) {
    await prisma.productReviewRequest.update({
      where: { id: loaded.id },
      data: { status: REVIEW_STATUS.SKIPPED, messageStatus: "missing_phone" },
    });
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const reviewUrl = buildProductReviewUrl(loaded);
  const partnerName = cleanName(sale?.partner?.name || "VoltaPizza");
  const text = `${partnerName}: valora tu pedido ${sale.code}: ${reviewUrl}`;
  const smsEstimate = estimateSmsParts(text);

  const reservation = await reserveSmsCreditForMessage(prisma, {
    partnerId: loaded.partnerId,
    couponCode: `review:${sale.code}`,
    customerId: loaded.customerId,
    to,
    quantity: smsEstimate.parts,
    meta: { smsEstimate },
  });

  if (!reservation.ok) {
    await prisma.productReviewRequest.update({
      where: { id: loaded.id },
      data: {
        status: REVIEW_STATUS.FAILED,
        messageStatus: reservation.error || "sms_credit_failed",
      },
    });
    return { ok: false, skipped: true, reason: reservation.error, reviewUrl };
  }

  const result = await sendTelnyxSms({
    to,
    text,
    tags: [`product-review:${loaded.id}`, `order:${sale.id}`, `partner:${loaded.partnerId}`],
  });

  if (!result.ok) {
    await refundSmsCreditForMessage(prisma, {
      partnerId: loaded.partnerId,
      couponCode: `review:${sale.code}`,
      customerId: loaded.customerId,
      reason: result.error?.title || "product_review_sms_failed",
      quantity: smsEstimate.parts,
      meta: { smsEstimate },
    }).catch((error) => {
      console.error("[product-reviews.sms] refund error:", error);
    });

    await prisma.productReviewRequest.update({
      where: { id: loaded.id },
      data: {
        status: REVIEW_STATUS.FAILED,
        messageStatus: result.error?.title || result.status || "failed",
        messageMeta: result,
      },
    });
    return { ...result, reviewUrl, ledgerId: reservation.ledgerId };
  }

  await prisma.productReviewRequest.update({
    where: { id: loaded.id },
    data: {
      status: REVIEW_STATUS.SENT,
      sentAt: new Date(),
      messageStatus: result.status || "sent",
      messageMeta: result,
    },
  });

  return { ...result, reviewUrl, ledgerId: reservation.ledgerId };
}

export async function processDueProductReviewRequests(prisma, { take = 20 } = {}) {
  const due = await prisma.productReviewRequest.findMany({
    where: {
      status: REVIEW_STATUS.PENDING,
      sendAfter: { lte: new Date() },
    },
    take,
    orderBy: { sendAfter: "asc" },
    include: {
      sale: {
        include: {
          partner: { select: { id: true, name: true } },
          store: { select: { id: true, storeName: true } },
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });

  const results = [];
  for (const request of due) {
    try {
      results.push(await sendProductReviewRequestSms(prisma, request));
    } catch (error) {
      console.error("[product-reviews.worker] send error:", error);
      results.push({ ok: false, error: error.message });
    }
  }

  return { ok: true, processed: results.length, results };
}

export function startProductReviewWorker(prisma) {
  if (process.env.NODE_ENV === "test") return null;

  const intervalMs = Math.max(30_000, Number(process.env.PRODUCT_REVIEW_WORKER_INTERVAL_MS || 300_000));
  const run = () => {
    processDueProductReviewRequests(prisma).catch((error) => {
      console.error("[product-reviews.worker] error:", error);
    });
  };

  const initialTimer = setTimeout(run, 15_000);
  const interval = setInterval(run, intervalMs);

  return {
    stop() {
      clearTimeout(initialTimer);
      clearInterval(interval);
    },
  };
}

export { REVIEW_STATUS };
