import express from "express";
import { getBoostSettings } from "../services/boostSettings.js";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseMaybeJson = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const asObject = (value) => {
  const parsed = parseMaybeJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

const asArray = (value) => {
  const first = parseMaybeJson(value, []);
  const second = parseMaybeJson(first, []);
  return Array.isArray(second) ? second : [];
};

const toRate = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const addBusinessDays = (date, amount) => {
  const next = new Date(date);
  const direction = amount >= 0 ? 1 : -1;
  let remaining = Math.abs(amount);

  while (remaining > 0) {
    next.setDate(next.getDate() + direction);
    const day = next.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }

  return next;
};

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const startOfNextMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);

const getPolicy = () => {
  const standardDelayBusinessDays = parsePositiveInt(process.env.VOLTA_STANDARD_CASHOUT_DAYS) || 3;
  const stripeInstantCostRate = toRate(process.env.VOLTA_STRIPE_INSTANT_COST_RATE, 0.01);
  const opportunityCostRate = toRate(process.env.VOLTA_CASHOUT_OPPORTUNITY_RATE, 0.0025);
  const platformMarkupRate = toRate(process.env.VOLTA_CASHOUT_MARKUP_RATE, 0.0025);
  const instantFeeMin = toRate(process.env.VOLTA_INSTANT_CASHOUT_MIN_FEE, 0.5);
  const platformFeeRate = toRate(process.env.VOLTA_PLATFORM_FEE_RATE, 0);
  const instantFeeRate = toRate(
    process.env.VOLTA_INSTANT_CASHOUT_FEE_RATE,
    stripeInstantCostRate + opportunityCostRate + platformMarkupRate
  );

  return {
    standardDelayBusinessDays,
    standardFeeRate: 0,
    instantFeeRate,
    instantFeeMin,
    stripeInstantCostRate,
    opportunityCostRate,
    platformMarkupRate,
    platformFeeRate,
    cashoutExecutionEnabled: process.env.VOLTA_CASHOUT_EXECUTION_ENABLED === "true",
    invoicesEnabled: process.env.VOLTA_INVOICES_ENABLED === "true",
  };
};

const quoteInstantCashout = (amount, policy) => {
  const fee = Math.max(amount * policy.instantFeeRate, policy.instantFeeMin);
  return {
    amount,
    fee,
    netAmount: Math.max(amount - fee, 0),
    feeRate: policy.instantFeeRate,
    feeMin: policy.instantFeeMin,
  };
};

const formatBillingSale = (sale, partnerCurrency = "EUR") => {
  const customerData = asObject(sale.customerData);
  const customerName = customerData.name || sale.customer?.name || "";

  return {
    id: sale.id,
    code: sale.code,
    date: sale.date,
    status: sale.status,
    storeId: sale.store?.id || null,
    storeName: sale.store?.storeName || "Sin tienda",
    customerId: sale.customerId || null,
    customerName,
    customerData: {
      name: customerName,
      phone: customerData.phone || sale.customer?.phone || "",
      email: customerData.email || sale.customer?.email || "",
      address_1: customerData.address_1 || sale.address_1 || sale.customer?.address_1 || "",
      code: sale.customer?.code || customerData.customerCode || "",
    },
    products: asArray(sale.products),
    extras: asArray(sale.extras),
    notes: sale.notes || "",
    total: sale.total,
    currency: sale.currency || partnerCurrency || "EUR",
  };
};

export default function billingRoutes(prisma) {
  const router = express.Router();

  router.get("/:partnerId/summary", async (req, res) => {
    const partnerId = parsePositiveInt(req.params.partnerId);

    if (!partnerId) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    try {
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          smsCredits: true,
          smsRecharged: true,
          smsConsumed: true,
        },
      });

      if (!partner) {
        return res.status(404).json({ error: "Partner not found" });
      }

      const now = new Date();
      const monthStart = startOfMonth(now);
      const nextMonthStart = startOfNextMonth(now);
      const policy = getPolicy();
      const boostSettings = await getBoostSettings(prisma);
      const standardCutoff = addBusinessDays(now, -policy.standardDelayBusinessDays);

      const sales = await prisma.sale.findMany({
        where: {
          partnerId,
          status: { not: "CANCELED" },
        },
        select: {
          id: true,
          code: true,
          date: true,
          customerId: true,
          status: true,
          total: true,
          currency: true,
          customerData: true,
          products: true,
          extras: true,
          notes: true,
          address_1: true,
          boostActive: true,
          boostAmount: true,
          boostMeta: true,
          store: {
            select: {
              id: true,
              storeName: true,
            },
          },
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
              phone: true,
              email: true,
              address_1: true,
            },
          },
        },
        orderBy: { date: "desc" },
      });

      const safeSales = sales
        .map((sale) => ({
          ...sale,
          total: Number(sale.total || 0),
        }))
        .filter((sale) => Number.isFinite(sale.total) && sale.total > 0);

      const paidSales = safeSales.filter((sale) => sale.status === "PAID");
      const monthSales = safeSales.filter((sale) => {
        const date = new Date(sale.date);
        return date >= monthStart && date < nextMonthStart;
      });
      const monthPaidSales = paidSales.filter((sale) => {
        const date = new Date(sale.date);
        return date >= monthStart && date < nextMonthStart;
      });

      const sum = (rows) => rows.reduce((acc, sale) => acc + sale.total, 0);
      const standardAvailableSales = paidSales.filter((sale) => new Date(sale.date) <= standardCutoff);
      const instantBridgeableSales = paidSales.filter((sale) => new Date(sale.date) > standardCutoff);

      const standardAvailable = sum(standardAvailableSales);
      const instantBridgeable = sum(instantBridgeableSales);
      const paidBalance = sum(paidSales);
      const operationalGross = sum(safeSales);
      const monthGross = sum(monthSales);
      const monthPaid = sum(monthPaidSales);
      const platformFeeDraft = monthGross * policy.platformFeeRate;
      const instantQuote = quoteInstantCashout(instantBridgeable, policy);
      const monthBoostSales = monthSales.filter((sale) => sale.boostActive);
      const monthBoostAmount = monthBoostSales.reduce(
        (sum, sale) => sum + Number(sale.boostAmount || 0),
        0
      );
      const monthBoostVolta = monthBoostSales.reduce((sum, sale) => {
        const meta = sale.boostMeta && typeof sale.boostMeta === "object"
          ? sale.boostMeta
          : {};
        const stored = Number(meta.voltaAmount);
        if (Number.isFinite(stored)) return sum + stored;
        return sum + Number(sale.boostAmount || 0) * (boostSettings.voltaSharePercent / 100);
      }, 0);
      const monthBoostPartner = Math.max(monthBoostAmount - monthBoostVolta, 0);

      const stores = new Map();
      safeSales.forEach((sale) => {
        const id = sale.store?.id || 0;
        const current = stores.get(id) || {
          storeId: id,
          storeName: sale.store?.storeName || "Sin tienda",
          orders: 0,
          gross: 0,
          paid: 0,
        };

        current.orders += 1;
        current.gross += sale.total;
        if (sale.status === "PAID") current.paid += sale.total;
        stores.set(id, current);
      });

      return res.json({
        partner: {
          id: partner.id,
          name: partner.name,
          slug: partner.slug,
          currency: partner.currency || "EUR",
        },
        currency: partner.currency || "EUR",
        policy,
        balances: {
          operationalGross,
          paidBalance,
          standardAvailable,
          instantBridgeable,
          cashoutableNow: standardAvailable + instantBridgeable,
          smsCredits: partner.smsCredits || 0,
          smsRecharged: partner.smsRecharged || 0,
          smsConsumed: partner.smsConsumed || 0,
        },
        invoiceDraft: {
          id: `draft-${partner.id}-${monthStart.toISOString().slice(0, 7)}`,
          status: policy.invoicesEnabled ? "READY_TO_SEND" : "DRAFT_NOT_CONNECTED",
          periodStart: monthStart,
          periodEnd: nextMonthStart,
          grossSales: monthGross,
          paidSales: monthPaid,
          platformFeeRate: policy.platformFeeRate,
          platformFeeAmount: platformFeeDraft,
          boostGross: monthBoostAmount,
          boostVoltaAmount: monthBoostVolta,
          boostPartnerAmount: monthBoostPartner,
          boostVoltaSharePercent: boostSettings.voltaSharePercent,
          currency: partner.currency || "EUR",
        },
        instantQuote,
        stores: [...stores.values()].sort((left, right) => right.gross - left.gross),
        recentSales: safeSales
          .slice(0, 8)
          .map((sale) => formatBillingSale(sale, partner.currency || "EUR")),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[billing.summary] error:", error);
      return res.status(500).json({ error: "Error building billing summary" });
    }
  });

  router.post("/:partnerId/invoices/send", async (req, res) => {
    const partnerId = parsePositiveInt(req.params.partnerId);
    if (!partnerId) return res.status(400).json({ error: "Valid partnerId required" });

    return res.status(501).json({
      ok: false,
      error: "billing_invoices_not_connected",
      message: "La estructura existe, pero falta conectar proveedor fiscal/email y ledger de facturacion.",
    });
  });

  router.post("/:partnerId/cashouts/instant", async (req, res) => {
    const partnerId = parsePositiveInt(req.params.partnerId);
    if (!partnerId) return res.status(400).json({ error: "Valid partnerId required" });

    return res.status(501).json({
      ok: false,
      error: "instant_cashout_not_connected",
      message: "La estructura existe, pero falta conectar Stripe Connect, cuenta externa elegible y ledger de cashouts.",
    });
  });

  return router;
}
