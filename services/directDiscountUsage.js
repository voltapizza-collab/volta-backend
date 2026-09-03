const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

const getLineQty = (line) => {
  const qty = Number(line?.qty ?? line?.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
};

let usageLimitColumnReady = false;

export const ensureDirectDiscountUsageLimitColumn = async (prisma) => {
  if (usageLimitColumnReady) return;

  let hasColumn = false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SHOW COLUMNS FROM `DirectDiscount` LIKE 'usageLimit'"
    );
    hasColumn = Boolean(rows?.length);
  } catch (error) {
    console.warn(
      "[direct-discounts] usageLimit column introspection failed:",
      error?.message || error
    );
  }

  if (hasColumn) {
    usageLimitColumnReady = true;
    return;
  }

  try {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `DirectDiscount` ADD COLUMN `usageLimit` INT NULL"
    );
  } catch (error) {
    const message = String(error?.message || "");
    const metaMessage = String(error?.meta?.message || "");
    if (!message.includes("Duplicate column name") && !metaMessage.includes("Duplicate column name")) {
      throw error;
    }
  }

  usageLimitColumnReady = true;
};

export const getDirectDiscountUsageLimit = (discount) => {
  if (discount?.usageLimit == null || discount.usageLimit === "") return null;

  const limit = Number(discount.usageLimit);
  return Number.isInteger(limit) && limit >= 0 ? limit : null;
};

export const getDirectDiscountRemainingQuantity = (discount, usedCount = 0) => {
  const usageLimit = getDirectDiscountUsageLimit(discount);
  if (usageLimit == null) return null;

  return Math.max(0, usageLimit - Math.max(0, Number(usedCount || 0)));
};

export const getLineDirectDiscountId = (line) =>
  parsePositiveInt(line?.directDiscount?.id ?? line?.directDiscountId ?? line?.topDealId);

export const getDirectDiscountUsageFromSales = (sales = [], discountIds = []) => {
  const trackedIds = new Set(
    discountIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  const counts = new Map([...trackedIds].map((id) => [id, 0]));

  if (!trackedIds.size) return counts;

  sales.forEach((sale) => {
    asArray(sale?.products).forEach((line) => {
      const discountId = getLineDirectDiscountId(line);
      if (!trackedIds.has(discountId)) return;

      counts.set(discountId, (counts.get(discountId) || 0) + getLineQty(line));
    });
  });

  return counts;
};

export const fetchDirectDiscountUsageCounts = async (prisma, { partnerId, discountIds }) => {
  const ids = [
    ...new Set(
      asArray(discountIds)
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
  const numericPartnerId = parsePositiveInt(partnerId);

  if (!numericPartnerId || !ids.length) return new Map();

  const sales = await prisma.sale.findMany({
    where: {
      partnerId: numericPartnerId,
      status: { not: "CANCELED" },
    },
    select: {
      products: true,
    },
  });

  return getDirectDiscountUsageFromSales(sales, ids);
};

export const attachDirectDiscountUsage = (discounts = [], usageCounts = new Map()) =>
  discounts.map((discount) => {
    const usedCount = Number(usageCounts.get(Number(discount.id)) || 0);
    const usageLimit = getDirectDiscountUsageLimit(discount);

    return {
      ...discount,
      usageLimit,
      usedCount,
      remainingQuantity: getDirectDiscountRemainingQuantity(discount, usedCount),
    };
  });

export const isDirectDiscountSoldOut = (discount) =>
  getDirectDiscountRemainingQuantity(discount, discount?.usedCount) === 0;

export const getDirectDiscountCartQuantities = (lines = []) => {
  const quantities = new Map();

  asArray(lines).forEach((line) => {
    const discountId = getLineDirectDiscountId(line);
    if (!discountId) return;

    quantities.set(discountId, (quantities.get(discountId) || 0) + getLineQty(line));
  });

  return quantities;
};
