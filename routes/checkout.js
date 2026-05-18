import express from "express";
import {
  constructStripeWebhookEvent,
  createOrderCheckoutSession,
  isStripeCheckoutConfigured,
} from "../services/stripe.js";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const toCents = (value) => Math.round(roundMoney(value) * 100);

const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeDigits = (value) => String(value || "").replace(/\D/g, "");

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

const getLineTotal = (line) => {
  if (isIncentiveRewardLine(line)) return 0;
  if (Number.isFinite(Number(line?.subtotal))) return roundMoney(line.subtotal);
  return roundMoney(Number(line?.price || 0) * getLineQty(line));
};

const sanitizeLine = (line, index) => ({
  cartLineId: String(line?.cartLineId || `line-${index}`),
  pizzaId: parsePositiveInt(line?.pizzaId),
  name: String(line?.name || line?.title || "Producto").trim().slice(0, 160),
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
  promoId: parsePositiveInt(line?.promoId),
  promoItems: asArray(line?.promoItems),
  couponId: parsePositiveInt(line?.couponId),
  couponCode: line?.couponCode ? String(line.couponCode).trim().toUpperCase() : null,
  coupon: line?.coupon && typeof line.coupon === "object" ? line.coupon : null,
  directDiscount: line?.directDiscount || null,
  incentiveId: parsePositiveInt(line?.incentiveId),
  rewardPizzaId: parsePositiveInt(line?.rewardPizzaId),
  boost: line?.boost && typeof line.boost === "object" ? line.boost : null,
});

const getEligibleCouponSubtotal = (lines) =>
  lines
    .filter((line) => {
      const type = String(line?.type || "").toUpperCase();
      const source = String(line?.source || "").toLowerCase();
      if (isCouponLine(line) || isIncentiveRewardLine(line)) return false;
      if (line?.directDiscount) return false;
      if (line?.promoId || type === "PROMO" || source === "promo") return false;
      if (source === "queue_boost") return false;
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

const buildReturnUrl = (req, status, fallbackPath = "/") => {
  const origin = String(req.body.frontendOrigin || process.env.FRONT_BASE_URL || process.env.PUBLIC_FRONTEND_URL || "").replace(/\/$/, "");
  const path = String(req.body.returnPath || fallbackPath || "/");
  const separator = path.includes("?") ? "&" : "?";
  return `${origin}${path}${separator}payment=${status}&session_id={CHECKOUT_SESSION_ID}`;
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

const resolveCheckoutCustomer = async (tx, { partnerId, customer, delivery }) => {
  const customerId = parsePositiveInt(customer?.id || customer?.customerId);
  const rawName = String(customer?.name || "").trim();
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
      ...(address && (!existing.address_1 || /^\(PICKUP\)/i.test(existing.address_1))
        ? { address_1: address, zipCode: extractZipCode(address) }
        : {}),
      ...(Number.isFinite(Number(delivery?.lat)) ? { lat: Number(delivery.lat) } : {}),
      ...(Number.isFinite(Number(delivery?.lng)) ? { lng: Number(delivery.lng) } : {}),
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

  const zipCode = extractZipCode(address);
  const geo = {
    ...(Number.isFinite(Number(delivery?.lat)) ? { lat: Number(delivery.lat) } : {}),
    ...(Number.isFinite(Number(delivery?.lng)) ? { lng: Number(delivery.lng) } : {}),
  };

  if (existing) {
    return tx.customer.update({
      where: { id: existing.id },
      data: {
        name: rawName || existing.name,
        phone: normalizedPhone,
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
      const [partner, store] = await Promise.all([
        prisma.partner.findUnique({
          where: { id: partnerId },
          select: { id: true, name: true, slug: true, currency: true },
        }),
        prisma.store.findFirst({
          where: { id: storeId, partnerId, active: true },
          select: { id: true, storeName: true, slug: true, address: true, city: true },
        }),
      ]);

      if (!partner || !store) {
        return res.status(404).json({ ok: false, error: "store_not_found" });
      }

      let lines = rawLines.map(sanitizeLine);
      const couponLine = lines.find(isCouponLine);
      const eligibleSubtotal = getEligibleCouponSubtotal(lines);

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
        });

        if (!customer) {
          const error = new Error("customer_profile_required");
          error.status = 400;
          throw error;
        }

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
        successUrl: buildReturnUrl(req, "success", `/${partner.slug}/${store.slug}`),
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
      return res.status(500).json({ ok: false, error: "checkout_failed" });
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
    const metadata = session.metadata || {};

    if (metadata.purpose !== "order_checkout") {
      return res.json({ ok: true, ignored: true });
    }

    if (session.payment_status && session.payment_status !== "paid") {
      return res.json({ ok: true, ignored: true, status: session.payment_status });
    }

    const saleId = parsePositiveInt(metadata.saleId);
    if (!saleId) {
      return res.status(400).json({ ok: false, error: "bad_order_metadata" });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const sale = await tx.sale.findUnique({ where: { id: saleId } });
        if (!sale) throw new Error("sale_not_found");

        if (sale.status === "PAID") return sale;

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
        return paidSale;
      });

      return res.json({ ok: true, status: "order_paid", saleId: updated.id, orderCode: updated.code });
    } catch (error) {
      console.error("[checkout.stripe-webhook] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  return router;
}
