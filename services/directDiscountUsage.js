const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const TZ = process.env.TIMEZONE || "Europe/Madrid";

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

const parseMaybeJson = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const toFiniteNumber = (value) => {
  if (value == null || value === "") return null;
  if (typeof value === "object" && typeof value.toNumber === "function") {
    try {
      const decimalValue = value.toNumber();
      return Number.isFinite(decimalValue) ? decimalValue : null;
    } catch {
      return null;
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseNullableUsageLimit = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const normalizeDayOfWeek = (value) => {
  if (value == null || String(value).trim() === "") return null;

  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric;

  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const map = {
    domingo: 0,
    dom: 0,
    lunes: 1,
    lun: 1,
    martes: 2,
    mar: 2,
    miercoles: 3,
    mie: 3,
    jueves: 4,
    jue: 4,
    viernes: 5,
    vie: 5,
    sabado: 6,
    sab: 6,
  };

  return map[normalized] ?? null;
};

const getReferenceDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
};

const normalizeDateKey = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  return getReferenceDateKey(trimmed);
};

export const normalizeDirectDiscountDailyOverrides = (value) => {
  const parsed = parseMaybeJson(value, value);
  const entries =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.entries(parsed).map(([dayOfWeek, override]) => ({
          ...(override && typeof override === "object" ? override : {}),
          dayOfWeek: override?.dayOfWeek ?? dayOfWeek,
        }))
      : Array.isArray(parsed)
        ? parsed
        : [];
  const byDay = new Map();

  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;

    const date = normalizeDateKey(entry.date ?? entry.localDate ?? entry.dayKey);
    const dayOfWeek = normalizeDayOfWeek(
      entry.dayOfWeek ?? entry.weekday ?? entry.day ?? entry.value
    );
    if (!date && dayOfWeek == null) return;

    const usageLimit = parseNullableUsageLimit(
      entry.usageLimit ?? entry.availableQuantity ?? entry.quantity
    );
    if (usageLimit == null) return;

    const normalized = { usageLimit };
    if (date) {
      normalized.date = date;
    } else {
      normalized.dayOfWeek = dayOfWeek;
    }

    byDay.set(date || `weekday:${dayOfWeek}`, normalized);
  });

  return [...byDay.values()].sort((left, right) => {
    const leftDate = String(left.date || "");
    const rightDate = String(right.date || "");
    if (leftDate || rightDate) return leftDate.localeCompare(rightDate);
    return left.dayOfWeek - right.dayOfWeek;
  });
};

export const getDirectDiscountDailyOverride = (discount, reference = new Date()) => {
  const referenceDate = reference instanceof Date ? reference : new Date(reference);
  if (Number.isNaN(referenceDate.getTime())) return null;

  const dateKey = getReferenceDateKey(referenceDate);
  const dayOfWeek = referenceDate.getDay();
  const overrides = normalizeDirectDiscountDailyOverrides(discount?.dailyOverrides);
  return (
    overrides.find((override) => override.date === dateKey) ||
    overrides.find((override) => !override.date && override.dayOfWeek === dayOfWeek) ||
    null
  );
};

export const getDirectDiscountEffectiveValue = (discount, reference = new Date()) => {
  const value = toFiniteNumber(discount?.value);

  return value != null ? value : 0;
};

const getLineQty = (line) => {
  const qty = Number(line?.qty ?? line?.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
};

let usageLimitColumnReady = false;
let dailyOverridesColumnReady = false;

const ensureDirectDiscountColumn = async (prisma, columnName, definition) => {
  let hasColumn = false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SHOW COLUMNS FROM \`DirectDiscount\` LIKE '${columnName}'`
    );
    hasColumn = Boolean(rows?.length);
  } catch (error) {
    console.warn(
      `[direct-discounts] ${columnName} column introspection failed:`,
      error?.message || error
    );
  }

  if (hasColumn) return true;

  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE \`DirectDiscount\` ADD COLUMN \`${columnName}\` ${definition}`
    );
  } catch (error) {
    const message = String(error?.message || "");
    const metaMessage = String(error?.meta?.message || "");
    if (!message.includes("Duplicate column name") && !metaMessage.includes("Duplicate column name")) {
      throw error;
    }
  }

  return true;
};

export const ensureDirectDiscountUsageLimitColumn = async (prisma) => {
  if (!usageLimitColumnReady) {
    await ensureDirectDiscountColumn(prisma, "usageLimit", "INT NULL");
    usageLimitColumnReady = true;
  }

  if (!dailyOverridesColumnReady) {
    await ensureDirectDiscountColumn(prisma, "dailyOverrides", "JSON NULL");
    dailyOverridesColumnReady = true;
  }
};

export const getDirectDiscountUsageLimit = (discount, reference = null) => {
  const override = reference ? getDirectDiscountDailyOverride(discount, reference) : null;
  if (override && Object.prototype.hasOwnProperty.call(override, "usageLimit")) {
    return override.usageLimit;
  }

  if (discount?.usageLimit == null || discount.usageLimit === "") return null;

  const limit = Number(discount.usageLimit);
  return Number.isInteger(limit) && limit >= 0 ? limit : null;
};

export const getDirectDiscountUsageLimitScope = (discount, reference = null) => {
  if (!reference) return "GLOBAL";

  return getDirectDiscountUsageLimit(discount, reference) == null ? "GLOBAL" : "DAILY";
};

export const getDirectDiscountRemainingQuantity = (discount, usedCount = 0, reference = null) => {
  const usageLimit = getDirectDiscountUsageLimit(discount, reference);
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

const getLocalDateKey = (value, timeZone = TZ) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${partMap.year}-${partMap.month}-${partMap.day}`;
};

export const getDirectDiscountDailyUsageFromSales = (
  sales = [],
  discountIds = [],
  reference = new Date(),
  timeZone = TZ
) => {
  const referenceKey = getReferenceDateKey(reference);
  if (!referenceKey) {
    return getDirectDiscountUsageFromSales([], discountIds);
  }

  return getDirectDiscountUsageFromSales(
    sales.filter((sale) => getLocalDateKey(sale?.date || sale?.createdAt, timeZone) === referenceKey),
    discountIds
  );
};

const normalizeDiscountIds = (discountIds) => [
  ...new Set(
    asArray(discountIds)
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  ),
];

export const fetchDirectDiscountUsageSummary = async (
  prisma,
  { partnerId, discountIds, reference = null, timeZone = TZ }
) => {
  const ids = normalizeDiscountIds(discountIds);
  const numericPartnerId = parsePositiveInt(partnerId);

  if (!numericPartnerId || !ids.length) {
    return { totalCounts: new Map(), dailyCounts: new Map() };
  }

  const sales = await prisma.sale.findMany({
    where: {
      partnerId: numericPartnerId,
      status: { not: "CANCELED" },
    },
    select: {
      products: true,
      date: true,
      createdAt: true,
    },
  });

  return {
    totalCounts: getDirectDiscountUsageFromSales(sales, ids),
    dailyCounts: reference
      ? getDirectDiscountDailyUsageFromSales(sales, ids, reference, timeZone)
      : new Map(ids.map((id) => [id, 0])),
  };
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

const normalizeUsageSummary = (usageSummary) => {
  if (usageSummary instanceof Map) {
    return { totalCounts: usageSummary, dailyCounts: new Map() };
  }

  return {
    totalCounts:
      usageSummary?.totalCounts instanceof Map ? usageSummary.totalCounts : new Map(),
    dailyCounts:
      usageSummary?.dailyCounts instanceof Map ? usageSummary.dailyCounts : new Map(),
  };
};

export const attachDirectDiscountUsage = (
  discounts = [],
  usageSummary = new Map(),
  { reference = null } = {}
) => {
  const { totalCounts, dailyCounts } = normalizeUsageSummary(usageSummary);

  return discounts.map((discount) => {
    const discountId = Number(discount.id);
    const totalUsedCount = Number(totalCounts.get(discountId) || 0);
    const dailyUsedCount = Number(dailyCounts.get(discountId) || 0);
    const usageLimitScope = reference
      ? getDirectDiscountUsageLimitScope(discount, reference)
      : "GLOBAL";
    const usedCount = usageLimitScope === "DAILY" ? dailyUsedCount : totalUsedCount;
    const usageLimit = getDirectDiscountUsageLimit(discount, reference);

    return {
      ...discount,
      dailyOverrides: normalizeDirectDiscountDailyOverrides(discount?.dailyOverrides),
      effectiveValue: reference
        ? getDirectDiscountEffectiveValue(discount, reference)
        : toFiniteNumber(discount?.value) ?? 0,
      globalUsageLimit: getDirectDiscountUsageLimit(discount),
      usageLimit,
      usedCount,
      totalUsedCount,
      dailyUsedCount,
      usageLimitScope,
      remainingQuantity:
        usageLimit == null
          ? null
          : Math.max(0, usageLimit - Math.max(0, Number(usedCount || 0))),
    };
  });
};

export const isDirectDiscountSoldOut = (discount, reference = null) =>
  getDirectDiscountRemainingQuantity(discount, discount?.usedCount, reference) === 0;

export const getDirectDiscountCartQuantities = (lines = []) => {
  const quantities = new Map();

  asArray(lines).forEach((line) => {
    const discountId = getLineDirectDiscountId(line);
    if (!discountId) return;

    quantities.set(discountId, (quantities.get(discountId) || 0) + getLineQty(line));
  });

  return quantities;
};
