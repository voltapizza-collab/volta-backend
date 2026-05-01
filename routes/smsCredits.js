import express from "express";
import {
  amountFromCredits,
  creditsFromAmount,
  getPartnerSmsBalance,
  getSmsCreditPackages,
  providerCreditsFromAmount,
  rechargeSmsCredits,
  SMS_PROVIDER_COST_EUR,
  SMS_SELL_PRICE_EUR,
} from "../services/smsCredits.js";
import { getTelnyxBalanceDetails } from "../services/telnyx.js";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseAmount = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export default function smsCreditsRoutes(prisma) {
  const router = express.Router();

  router.get("/quote", (req, res) => {
    const amount = parseAmount(req.query.amount);
    const quantity = parsePositiveInt(req.query.quantity);
    const credits = quantity || creditsFromAmount(amount);

    if (!credits) {
      return res.status(400).json({ ok: false, error: "bad_recharge_amount" });
    }

    return res.json({
      ok: true,
      credits,
      amount: amount || amountFromCredits(credits),
      sellPrice: Number(SMS_SELL_PRICE_EUR),
      providerCost: Number(SMS_PROVIDER_COST_EUR),
    });
  });

  router.get("/global/summary", async (_req, res) => {
    try {
      const [partners, ledger, telnyxBalance] = await Promise.all([
        prisma.partner.findMany({
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            slug: true,
            smsCredits: true,
            smsRecharged: true,
            smsConsumed: true,
            smsLowBalanceThreshold: true,
          },
        }),
        prisma.smsCreditLedger.findMany({
          orderBy: { createdAt: "desc" },
          take: 30,
          include: {
            partner: {
              select: { id: true, name: true, slug: true },
            },
          },
        }),
        getTelnyxBalanceDetails(),
      ]);

      const totals = partners.reduce(
        (summary, partner) => ({
          credits: summary.credits + partner.smsCredits,
          recharged: summary.recharged + partner.smsRecharged,
          consumed: summary.consumed + partner.smsConsumed,
        }),
        { credits: 0, recharged: 0, consumed: 0 }
      );

      const telnyxAvailableCredit = Number(String(telnyxBalance.availableCredit || "0").replace(",", "."));
      const telnyxAvailableMessages =
        telnyxBalance.ok && Number.isFinite(telnyxAvailableCredit)
          ? providerCreditsFromAmount(telnyxAvailableCredit)
          : null;
      const availableToSell =
        telnyxAvailableMessages == null ? null : Math.max(telnyxAvailableMessages - totals.credits, 0);

      return res.json({
        ok: true,
        pricing: {
          sellPrice: Number(SMS_SELL_PRICE_EUR),
          providerCost: Number(SMS_PROVIDER_COST_EUR),
          messagesPer10Eur: creditsFromAmount(10),
        },
        packages: getSmsCreditPackages(),
        providerInventory: {
          ok: telnyxBalance.ok,
          currency: telnyxBalance.currency || null,
          balance: telnyxBalance.balance || null,
          pending: telnyxBalance.pending || null,
          availableCredit: telnyxBalance.availableCredit || null,
          availableMessages: telnyxAvailableMessages,
          committedMessages: totals.credits,
          availableToSell,
          error: telnyxBalance.ok ? null : telnyxBalance.error,
        },
        totals,
        estimatedMarginEur: Number((totals.consumed * (Number(SMS_SELL_PRICE_EUR) - Number(SMS_PROVIDER_COST_EUR))).toFixed(4)),
        partners: partners.map((partner) => ({
          ...partner,
          isLow: partner.smsCredits <= partner.smsLowBalanceThreshold,
        })),
        ledger,
      });
    } catch (error) {
      console.error("[sms-credits.global] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.get("/:partnerId", async (req, res) => {
    const partnerId = parsePositiveInt(req.params.partnerId);
    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    try {
      const [balance, ledger] = await Promise.all([
        getPartnerSmsBalance(prisma, partnerId),
        prisma.smsCreditLedger.findMany({
          where: { partnerId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

      if (!balance) {
        return res.status(404).json({ ok: false, error: "partner_not_found" });
      }

      return res.json({
        ok: true,
        balance,
        pricing: {
          sellPrice: Number(SMS_SELL_PRICE_EUR),
          providerCost: Number(SMS_PROVIDER_COST_EUR),
          messagesPer10Eur: creditsFromAmount(10),
        },
        packages: getSmsCreditPackages(),
        ledger,
      });
    } catch (error) {
      console.error("[sms-credits.partner] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/:partnerId/recharge", async (req, res) => {
    const partnerId = parsePositiveInt(req.params.partnerId);
    const packageAmount = parseAmount(req.body.packageAmount);
    const amount = packageAmount || req.body.amount;

    try {
      const requestedCredits = parsePositiveInt(req.body.quantity) || creditsFromAmount(amount);
      if (!requestedCredits) {
        return res.status(400).json({ ok: false, error: "bad_recharge_amount" });
      }

      const [currentLiability, telnyxBalance] = await Promise.all([
        prisma.partner.aggregate({ _sum: { smsCredits: true } }),
        getTelnyxBalanceDetails(),
      ]);
      const committedMessages = currentLiability._sum.smsCredits || 0;
      const telnyxAvailableCredit = Number(String(telnyxBalance.availableCredit || "0").replace(",", "."));
      const telnyxAvailableMessages =
        telnyxBalance.ok && Number.isFinite(telnyxAvailableCredit)
          ? providerCreditsFromAmount(telnyxAvailableCredit)
          : null;
      const availableToSell =
        telnyxAvailableMessages == null ? null : Math.max(telnyxAvailableMessages - committedMessages, 0);

      if (availableToSell != null && requestedCredits > availableToSell) {
        return res.status(409).json({
          ok: false,
          error: "insufficient_volta_sms_inventory",
          requestedCredits,
          availableToSell,
        });
      }

      const result = await rechargeSmsCredits(prisma, {
        partnerId,
        amount,
        quantity: req.body.quantity,
        reference: req.body.reference || "manual_recharge",
        note: req.body.note || null,
        meta: {
          source: req.body.source || "portal",
          paymentStatus: req.body.paymentStatus || "manual_record",
          packageAmount: packageAmount || null,
          providerInventory: {
            checked: telnyxBalance.ok,
            availableMessages: telnyxAvailableMessages,
            availableToSell,
            currency: telnyxBalance.currency || null,
          },
        },
      });

      if (!result.ok) {
        return res.status(400).json(result);
      }

      return res.json({
        ok: true,
        status: "manual_recharge_recorded",
        ...result,
      });
    } catch (error) {
      console.error("[sms-credits.recharge] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  return router;
}
