const SELL_PRICE_UNITS = 8; // EUR 0.0008 in ten-thousandths of one euro.
const PROVIDER_COST_UNITS = 4; // EUR 0.0004 in ten-thousandths of one euro.

export const SMS_SELL_PRICE_EUR = "0.0008";
export const SMS_PROVIDER_COST_EUR = "0.0004";
export const SMS_CREDIT_PACKAGE_AMOUNTS_EUR = [10, 15, 20, 25, 30, 35, 40, 45, 50];

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseAmountCents = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
};

export const creditsFromAmount = (amount) => {
  const cents = parseAmountCents(amount);
  if (cents == null) return null;
  return Math.floor((cents * 100) / SELL_PRICE_UNITS);
};

export const amountFromCredits = (credits) => {
  const quantity = parsePositiveInt(credits);
  if (!quantity) return null;
  return Number(((quantity * SELL_PRICE_UNITS) / 10000).toFixed(2));
};

export const providerCreditsFromAmount = (amount) => {
  const cents = parseAmountCents(amount);
  if (cents == null) return null;
  return Math.floor((cents * 100) / PROVIDER_COST_UNITS);
};

export const getSmsCreditPackages = () =>
  SMS_CREDIT_PACKAGE_AMOUNTS_EUR.map((amount) => ({
    amount,
    credits: creditsFromAmount(amount),
    label: `${amount} EUR`,
  }));

export async function getPartnerSmsBalance(prisma, partnerId) {
  const id = parsePositiveInt(partnerId);
  if (!id) return null;

  const partner = await prisma.partner.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      smsCredits: true,
      smsRecharged: true,
      smsConsumed: true,
      smsLowBalanceThreshold: true,
    },
  });

  if (!partner) return null;

  return {
    ...partner,
    sellPrice: Number(SMS_SELL_PRICE_EUR),
    providerCost: Number(SMS_PROVIDER_COST_EUR),
    isLow: partner.smsCredits <= partner.smsLowBalanceThreshold,
  };
}

export async function rechargeSmsCredits(prisma, { partnerId, amount, quantity, reference, note, meta } = {}) {
  const id = parsePositiveInt(partnerId);
  const amountCents = parseAmountCents(amount);
  const parsedQuantity = parsePositiveInt(quantity);
  const credits = parsedQuantity || creditsFromAmount(amount);

  if (!id) {
    return { ok: false, error: "partnerId_required" };
  }

  if (!credits) {
    return { ok: false, error: "bad_recharge_amount" };
  }

  const amountValue = amountCents != null ? (amountCents / 100).toFixed(2) : amountFromCredits(credits).toFixed(2);

  return prisma.$transaction(async (tx) => {
    const partner = await tx.partner.update({
      where: { id },
      data: {
        smsCredits: { increment: credits },
        smsRecharged: { increment: credits },
      },
      select: {
        id: true,
        name: true,
        smsCredits: true,
        smsRecharged: true,
        smsConsumed: true,
        smsLowBalanceThreshold: true,
      },
    });

    const ledger = await tx.smsCreditLedger.create({
      data: {
        partnerId: id,
        type: "RECHARGE",
        quantity: credits,
        balanceAfter: partner.smsCredits,
        amount: amountValue,
        unitPrice: SMS_SELL_PRICE_EUR,
        providerCost: SMS_PROVIDER_COST_EUR,
        provider: "telnyx",
        reference: reference ? String(reference).slice(0, 191) : null,
        note: note ? String(note) : null,
        meta: meta && typeof meta === "object" ? meta : null,
      },
    });

    return {
      ok: true,
      credits,
      amount: Number(amountValue),
      balance: {
        ...partner,
        sellPrice: Number(SMS_SELL_PRICE_EUR),
        providerCost: Number(SMS_PROVIDER_COST_EUR),
        isLow: partner.smsCredits <= partner.smsLowBalanceThreshold,
      },
      ledgerId: ledger.id,
    };
  });
}

export async function reserveSmsCreditForMessage(prisma, { partnerId, couponCode, customerId, to } = {}) {
  const id = parsePositiveInt(partnerId);
  if (!id) return { ok: false, error: "partnerId_required" };

  return prisma.$transaction(async (tx) => {
    const updated = await tx.partner.updateMany({
      where: {
        id,
        smsCredits: { gte: 1 },
      },
      data: {
        smsCredits: { decrement: 1 },
        smsConsumed: { increment: 1 },
      },
    });

    if (!updated.count) {
      const current = await tx.partner.findUnique({
        where: { id },
        select: { smsCredits: true },
      });
      return {
        ok: false,
        error: "insufficient_sms_credits",
        balance: current?.smsCredits || 0,
      };
    }

    const partner = await tx.partner.findUnique({
      where: { id },
      select: { smsCredits: true },
    });

    const ledger = await tx.smsCreditLedger.create({
      data: {
        partnerId: id,
        type: "CONSUME",
        quantity: -1,
        balanceAfter: partner.smsCredits,
        unitPrice: SMS_SELL_PRICE_EUR,
        providerCost: SMS_PROVIDER_COST_EUR,
        provider: "telnyx",
        reference: couponCode || null,
        meta: {
          couponCode: couponCode || null,
          customerId: customerId || null,
          to: to || null,
        },
      },
    });

    return {
      ok: true,
      balanceAfter: partner.smsCredits,
      ledgerId: ledger.id,
    };
  });
}

export async function refundSmsCreditForMessage(prisma, { partnerId, couponCode, customerId, reason } = {}) {
  const id = parsePositiveInt(partnerId);
  if (!id) return { ok: false, error: "partnerId_required" };

  return prisma.$transaction(async (tx) => {
    const partner = await tx.partner.update({
      where: { id },
      data: {
        smsCredits: { increment: 1 },
        smsConsumed: { decrement: 1 },
      },
      select: { smsCredits: true },
    });

    const ledger = await tx.smsCreditLedger.create({
      data: {
        partnerId: id,
        type: "REFUND",
        quantity: 1,
        balanceAfter: partner.smsCredits,
        unitPrice: SMS_SELL_PRICE_EUR,
        providerCost: SMS_PROVIDER_COST_EUR,
        provider: "telnyx",
        reference: couponCode || null,
        meta: {
          couponCode: couponCode || null,
          customerId: customerId || null,
          reason: reason || null,
        },
      },
    });

    return {
      ok: true,
      balanceAfter: partner.smsCredits,
      ledgerId: ledger.id,
    };
  });
}
