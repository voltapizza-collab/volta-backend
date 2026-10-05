const PROVIDER_COST_UNITS = 620; // EUR 0.0620 in ten-thousandths of one euro.
const PROVIDER_COST_USD_UNITS = 710; // USD 0.0710 in ten-thousandths of one dollar.

export const SMS_SELL_PRICE_EUR = "0.0750";
export const SMS_PROVIDER_COST_EUR = "0.0620";
export const SMS_PROVIDER_COST_USD = "0.0710";
export const SMS_PRICING_RESET_REFERENCE = "sms-pricing-reset-2026-06-07";
export const SMS_CREDIT_PACKAGE_AMOUNTS_EUR = [10, 15, 20, 25, 30, 35, 40, 45, 50];

export function normalizeSmsPrice(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || Number(raw) < 0.0001 || Number(raw) > 10) {
    throw Object.assign(new Error('invalid_sms_price'), { status: 400 });
  }
  return Number(raw).toFixed(4);
}
export async function readSmsPrice(prisma) {
  const pricing = await prisma.onboardingPricing?.findUnique({ where: { id: 1 } });
  return normalizeSmsPrice(pricing?.defaults?.smsUnitPriceEur ?? SMS_SELL_PRICE_EUR);
}
export const smsPricingInfo = (price = SMS_SELL_PRICE_EUR) => ({ unitPriceEur: price, unit: 'SMS_SEGMENT',
  usageOptional: true, initialRecharge: 'SEPARATE', packages: getSmsCreditPackages(price) });

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

export const creditsFromAmount = (amount, price = SMS_SELL_PRICE_EUR) => {
  const cents = parseAmountCents(amount);
  if (cents == null) return null;
  return Math.floor((cents * 100) / Math.round(Number(normalizeSmsPrice(price)) * 10000));
};

export const amountFromCredits = (credits, price = SMS_SELL_PRICE_EUR) => {
  const quantity = parsePositiveInt(credits);
  if (!quantity) return null;
  return Number((quantity * Number(normalizeSmsPrice(price))).toFixed(2));
};

export const providerCreditsFromAmount = (amount, currency = "EUR") => {
  const cents = parseAmountCents(amount);
  if (cents == null) return null;
  const normalizedCurrency = String(currency || "EUR").trim().toUpperCase();
  const providerCostUnits = normalizedCurrency === "USD" ? PROVIDER_COST_USD_UNITS : PROVIDER_COST_UNITS;
  return Math.floor((cents * 100) / providerCostUnits);
};

export const getSmsCreditPackages = (price = SMS_SELL_PRICE_EUR) =>
  SMS_CREDIT_PACKAGE_AMOUNTS_EUR.map((amount) => ({
    amount,
    credits: creditsFromAmount(amount, price),
    label: `${amount} EUR - ${creditsFromAmount(amount, price)} partes de SMS`,
    unit: "SMS_1_PART",
  }));

export async function getPartnerSmsBalance(prisma, partnerId, unitPriceEur) {
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
    sellPrice: Number(unitPriceEur == null ? await readSmsPrice(prisma) : normalizeSmsPrice(unitPriceEur)),
    providerCost: Number(SMS_PROVIDER_COST_EUR),
    isLow: partner.smsCredits <= partner.smsLowBalanceThreshold,
  };
}

export async function rechargeSmsCredits(prisma, { partnerId, amount, quantity, reference, note, meta, unitPriceEur } = {}) {
  const price = unitPriceEur == null ? await readSmsPrice(prisma) : normalizeSmsPrice(unitPriceEur);
  const id = parsePositiveInt(partnerId);
  const amountCents = parseAmountCents(amount);
  const parsedQuantity = parsePositiveInt(quantity);
  const credits = parsedQuantity || creditsFromAmount(amount, price);

  if (!id) {
    return { ok: false, error: "partnerId_required" };
  }

  if (!credits) {
    return { ok: false, error: "bad_recharge_amount" };
  }

  const amountValue = amountCents != null ? (amountCents / 100).toFixed(2) : amountFromCredits(credits, price).toFixed(2);

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
        unitPrice: price,
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
        sellPrice: Number(price),
        providerCost: Number(SMS_PROVIDER_COST_EUR),
        isLow: partner.smsCredits <= partner.smsLowBalanceThreshold,
      },
      ledgerId: ledger.id,
    };
  });
}

export async function reserveSmsCreditForMessage(
  prisma,
  { partnerId, couponCode, customerId, to, reference, quantity = 1, meta } = {}
) {
  const id = parsePositiveInt(partnerId);
  if (!id) return { ok: false, error: "partnerId_required" };
  const credits = parsePositiveInt(quantity) || 1;
  const ledgerReference = reference || couponCode || null;
  const price = await readSmsPrice(prisma);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.partner.updateMany({
      where: {
        id,
        smsCredits: { gte: credits },
      },
      data: {
        smsCredits: { decrement: credits },
        smsConsumed: { increment: credits },
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
        quantity: -credits,
        balanceAfter: partner.smsCredits,
        unitPrice: price,
        providerCost: SMS_PROVIDER_COST_EUR,
        provider: "telnyx",
        reference: ledgerReference,
        meta: {
          couponCode: couponCode || null,
          customerId: customerId || null,
          to: to || null,
          reservedCredits: credits,
          ...(meta && typeof meta === "object" ? meta : {}),
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

export async function refundSmsCreditForMessage(
  prisma,
  { partnerId, couponCode, customerId, reason, reference, quantity = 1, meta } = {}
) {
  const id = parsePositiveInt(partnerId);
  if (!id) return { ok: false, error: "partnerId_required" };
  const credits = parsePositiveInt(quantity) || 1;
  const ledgerReference = reference || couponCode || null;
  const price = await readSmsPrice(prisma);

  return prisma.$transaction(async (tx) => {
    const partner = await tx.partner.update({
      where: { id },
      data: {
        smsCredits: { increment: credits },
        smsConsumed: { decrement: credits },
      },
      select: { smsCredits: true },
    });

    const ledger = await tx.smsCreditLedger.create({
      data: {
        partnerId: id,
        type: "REFUND",
        quantity: credits,
        balanceAfter: partner.smsCredits,
        unitPrice: price,
        providerCost: SMS_PROVIDER_COST_EUR,
        provider: "telnyx",
        reference: ledgerReference,
        meta: {
          couponCode: couponCode || null,
          customerId: customerId || null,
          reason: reason || null,
          refundedCredits: credits,
          ...(meta && typeof meta === "object" ? meta : {}),
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
