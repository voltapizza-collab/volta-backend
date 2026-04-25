import express from "express";

const router = express.Router();

const TZ = process.env.TIMEZONE || "Europe/Madrid";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PREFIX = {
  RANDOM_PERCENT: "VOL-RC",
  FIXED_PERCENT: "VOL-PF",
  FIXED_AMOUNT: "VOL-CD",
  SURPRISE_AMOUNT: "VOL-CS",
};
const SURPRISE_AMOUNT_CAMPAIGN = "SURPRISE_AMOUNT";
const SURPRISE_AMOUNT_CAMPAIGNS = [SURPRISE_AMOUNT_CAMPAIGN, "PIZZA_GRATIS_QR"];
const SURPRISE_DISTRIBUTION = [
  { key: "min", weight: 75 },
  { key: "mid", weight: 15 },
  { key: "max", weight: 10 },
];
const VALID_SEGMENTS = ["S1", "S2", "S3", "S4", "S5"];
const VALID_ACTIVITIES = ["HOT", "COLD"];
const VALID_TARGET_TAGS = [...VALID_SEGMENTS, ...VALID_ACTIVITIES];
const VALID_TYPES = ["RANDOM_PERCENT", "FIXED_PERCENT", "FIXED_AMOUNT", "SURPRISE_AMOUNT"];
const COLD_DAYS_THRESHOLD = 15;

const toNum = (value) => {
  if (value == null) return null;
  if (typeof value === "object" && typeof value.toNumber === "function") {
    try {
      return value.toNumber();
    } catch {
      return null;
    }
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseDecimal = (value) => {
  if (value == null || value === "") return null;
  const normalized = Number(String(value).replace(",", "."));
  return Number.isFinite(normalized) ? normalized : null;
};

const toMoney = (value) => {
  const parsed = parseDecimal(value);
  return parsed == null ? null : String(parsed.toFixed(2));
};

const toCents = (value) => {
  const parsed = parseDecimal(value);
  return parsed == null ? null : Math.round(parsed * 100);
};

const moneyFromCents = (cents) => String((cents / 100).toFixed(2));

const numberFromCents = (cents) => Number((cents / 100).toFixed(2));

const defaultSurpriseMidCents = (minCents, maxCents) => {
  const halfMax = Math.floor(maxCents / 2);
  if (halfMax > minCents && halfMax < maxCents) return halfMax;
  return Math.floor((minCents + maxCents) / 2);
};

const normalizePhone = (value = "") => String(value).replace(/[^\d]/g, "");

const toE164ES = (value = "") => {
  const digits = normalizePhone(value);
  if (digits.length === 9) return `+34${digits}`;
  if (digits.length === 11 && digits.startsWith("34")) return `+${digits}`;
  return null;
};

const base9Phone = (value = "") => {
  const digits = normalizePhone(value);
  if (digits.length === 9) return digits;
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  return null;
};

const pick = (length) =>
  Array.from({ length }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

const codePattern = (prefix) => `${prefix}${pick(6)}`;

const nowInTZ = () => {
  const snapshot = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  return new Date(snapshot.replace(" ", "T"));
};

const minutesOfDay = (dateLike) => {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return date.getHours() * 60 + date.getMinutes();
};

const toNullableFloat = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const esDayToNum = (value) => {
  const map = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
  };
  const normalized = String(value || "").toLowerCase();
  return normalized in map ? map[normalized] : null;
};

const normalizeDaysActive = (value) => {
  if (!value) return [];
  let list = value;

  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = [value];
    }
  }

  if (!Array.isArray(list)) list = [list];

  const mapped = list
    .map((item) => {
      if (typeof item === "number" && item >= 0 && item <= 6) return item;
      return esDayToNum(item);
    })
    .filter((item) => item != null);

  return [...new Set(mapped)].sort();
};

const normalizeTargetTags = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => String(item || "").trim().toUpperCase())
      .filter((item) => VALID_TARGET_TAGS.includes(item))
  )];
};

const splitTargetTags = (value) => {
  const tags = normalizeTargetTags(value);
  return {
    segments: tags.filter((item) => VALID_SEGMENTS.includes(item)),
    activities: tags.filter((item) => VALID_ACTIVITIES.includes(item)),
  };
};

const normalizeStoreIds = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => parsePositiveInt(item))
      .filter(Boolean)
  )];
};

const normalizeZipCodes = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => {
        const match = String(item || "").match(/\b(\d{5})\b/);
        return match ? match[1] : null;
      })
      .filter(Boolean)
  )];
};

const normalizeZipCode = (value) => {
  const match = String(value || "").match(/\b(\d{5})\b/);
  return match ? match[1] : null;
};

const postalAreaKey = (postalCode) => {
  const digits = String(postalCode || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(0, 3) : "";
};

const readCouponMeta = (coupon) => {
  if (!coupon?.meta || typeof coupon.meta !== "object" || Array.isArray(coupon.meta)) {
    return {};
  }
  return coupon.meta;
};

const isSurpriseAmountCoupon = (coupon) => {
  const campaign = String(coupon?.campaign || "").toUpperCase();
  const meta = readCouponMeta(coupon);
  return SURPRISE_AMOUNT_CAMPAIGNS.includes(campaign) || Boolean(meta.surpriseAmount);
};

const readSurpriseAmountMeta = (coupon) => {
  const meta = readCouponMeta(coupon);
  const surprise =
    meta.surpriseAmount && typeof meta.surpriseAmount === "object" && !Array.isArray(meta.surpriseAmount)
      ? meta.surpriseAmount
      : {};

  return {
    minAmount: toNum(surprise.minAmount),
    midAmount: toNum(surprise.midAmount),
    maxAmount: toNum(surprise.maxAmount),
  };
};

const readCouponTargeting = (coupon) => {
  const meta = readCouponMeta(coupon);
  const targeting =
    meta.targeting && typeof meta.targeting === "object" && !Array.isArray(meta.targeting)
      ? meta.targeting
      : {};
  const targetStores = Array.isArray(meta.targetStores) ? meta.targetStores : [];

  return {
    storeIds: normalizeStoreIds(targeting.storeIds),
    zipCodes: normalizeZipCodes(targeting.zipCodes),
    targetStores: targetStores
      .map((store) => ({
        id: parsePositiveInt(store?.id),
        zipCode: normalizeZipCode(store?.zipCode),
      }))
      .filter((store) => store.id || store.zipCode),
  };
};

const hasTerritorialTargeting = (coupon) => {
  const { storeIds, zipCodes } = readCouponTargeting(coupon);
  return Boolean(storeIds.length || zipCodes.length);
};

const matchesCouponTerritory = (coupon, zipCode) => {
  const { storeIds, zipCodes, targetStores } = readCouponTargeting(coupon);
  if (!storeIds.length && !zipCodes.length) return true;

  const normalizedZip = normalizeZipCode(zipCode);
  if (!normalizedZip) return false;

  const areaKey = postalAreaKey(normalizedZip);
  if (zipCodes.includes(normalizedZip)) return true;

  if (!storeIds.length) return false;

  return targetStores.some((store) => {
    const storeZip = normalizeZipCode(store.zipCode);
    if (!storeZip) return false;
    if (storeZip === normalizedZip) return true;

    const storeArea = postalAreaKey(storeZip);
    return Boolean(areaKey && storeArea && areaKey === storeArea);
  });
};

const uniqueCustomers = (rows = []) => {
  const map = new Map();
  rows.forEach((item) => {
    if (item?.id && !map.has(item.id)) map.set(item.id, item);
  });
  return Array.from(map.values());
};

const isActiveByDate = (coupon, reference = nowInTZ()) => {
  const current = reference.getTime();
  if (coupon.activeFrom && new Date(coupon.activeFrom).getTime() > current) return false;
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= current) return false;
  return true;
};

const isWithinWindow = (coupon, reference = nowInTZ()) => {
  const days = normalizeDaysActive(coupon.daysActive);
  if (!days.length && coupon.windowStart == null && coupon.windowEnd == null) return true;

  if (days.length && !days.includes(reference.getDay())) return false;

  const start = coupon.windowStart == null ? 0 : Number(coupon.windowStart);
  const end = coupon.windowEnd == null ? 24 * 60 : Number(coupon.windowEnd);
  const minutes = minutesOfDay(reference);

  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
};

const buildCouponTitle = (coupon) => {
  if (isSurpriseAmountCoupon(coupon)) return "Cupon sorpresa";

  const percent = toNum(coupon.percent);
  const percentMin = toNum(coupon.percentMin);
  const percentMax = toNum(coupon.percentMax);
  const amount = toNum(coupon.amount);

  if (coupon.kind === "PERCENT" && coupon.variant === "RANGE" && percentMin != null && percentMax != null) {
    return `${percentMin}-${percentMax}%`;
  }

  if (coupon.kind === "PERCENT" && percent != null) {
    return `${percent}%`;
  }

  if (coupon.kind === "AMOUNT" && amount != null) {
    return `${amount.toFixed(2)} EUR`;
  }

  return "Cupon";
};

const buildCouponType = (coupon) => {
  if (isSurpriseAmountCoupon(coupon)) return "SURPRISE_AMOUNT";
  if (coupon.kind === "PERCENT" && coupon.variant === "RANGE") return "RANDOM_PERCENT";
  if (coupon.kind === "PERCENT" && coupon.variant === "FIXED") return "FIXED_PERCENT";
  if (coupon.kind === "AMOUNT" && coupon.variant === "FIXED") return "FIXED_AMOUNT";
  return "UNKNOWN";
};

const hasSegmentTargeting = (coupon) => normalizeTargetTags(Array.isArray(coupon?.segments) ? coupon.segments : []).length > 0;

const haversineKm = (leftLat, leftLng, rightLat, rightLng) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(rightLat - leftLat);
  const dLng = toRad(rightLng - leftLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(leftLat)) * Math.cos(toRad(rightLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
};

const buildCouponKey = (coupon) => {
  if (isSurpriseAmountCoupon(coupon)) {
    const { minAmount, midAmount, maxAmount } = readSurpriseAmountMeta(coupon);
    if (minAmount != null && midAmount != null && maxAmount != null) {
      return `SURPRISE:${minAmount.toFixed(2)}:${midAmount.toFixed(2)}:${maxAmount.toFixed(2)}`;
    }
    return "SURPRISE";
  }

  const amount = toNum(coupon.amount);
  const percent = toNum(coupon.percent);
  const percentMin = toNum(coupon.percentMin);
  const percentMax = toNum(coupon.percentMax);

  if (coupon.kind === "PERCENT" && coupon.variant === "RANGE" && percentMin != null && percentMax != null) {
    return `${percentMin}-${percentMax}`;
  }

  if (coupon.kind === "PERCENT" && percent != null) {
    return String(percent);
  }

  if (coupon.kind === "AMOUNT" && amount != null) {
    return amount.toFixed(2);
  }

  return coupon.code;
};

const buildTypeWhere = (type, key) => {
  if (type === "SURPRISE_AMOUNT" || key === "SURPRISE") {
    return { campaign: { in: SURPRISE_AMOUNT_CAMPAIGNS }, kind: "AMOUNT", variant: "FIXED" };
  }

  if (type === "FIXED_PERCENT") {
    const percent = Number(String(key || "").replace("%", "").trim());
    if (!Number.isFinite(percent)) return null;
    return { kind: "PERCENT", variant: "FIXED", percent };
  }

  if (type === "RANDOM_PERCENT") {
    const match = String(key || "").match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (!match) return null;
    const percentMin = Number(match[1]);
    const percentMax = Number(match[2]);
    return { kind: "PERCENT", variant: "RANGE", percentMin, percentMax };
  }

  if (type === "FIXED_AMOUNT") {
    const amount = Number(String(key || "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { kind: "AMOUNT", variant: "FIXED", amount: String(amount.toFixed(2)) };
  }

  return null;
};

const customerActivityTag = (customer) =>
  Number(customer?.daysOff || 0) > COLD_DAYS_THRESHOLD ? "COLD" : "HOT";

const customerMatchesCouponTargetTags = (customer, coupon) => {
  const tags = normalizeTargetTags(Array.isArray(coupon?.segments) ? coupon.segments : []);
  if (!tags.length) return true;

  const requiredSegments = tags.filter((tag) => VALID_SEGMENTS.includes(tag));
  const requiredActivities = tags.filter((tag) => VALID_ACTIVITIES.includes(tag));

  if (requiredSegments.length) {
    const customerSegment = String(customer?.segment || "").trim().toUpperCase();
    if (!requiredSegments.includes(customerSegment)) return false;
  }

  if (requiredActivities.length) {
    const activity = customerActivityTag(customer);
    if (!requiredActivities.includes(activity)) return false;
  }

  return true;
};

const parseCouponDefinition = (type, source) => {
  let kind;
  let variant;
  let percent = null;
  let percentMin = null;
  let percentMax = null;
  let amount = null;
  let surprise = null;

  if (type === "RANDOM_PERCENT") {
    kind = "PERCENT";
    variant = "RANGE";
    percentMin = Number(source.percentMin);
    percentMax = Number(source.percentMax);
    if (!Number.isFinite(percentMin) || !Number.isFinite(percentMax) || percentMin < 1 || percentMax > 90 || percentMin > percentMax) {
      return { error: "bad_range" };
    }
  } else if (type === "FIXED_PERCENT") {
    kind = "PERCENT";
    variant = "FIXED";
    percent = Number(source.percent);
    if (!Number.isFinite(percent) || percent < 1 || percent > 90) {
      return { error: "bad_percent" };
    }
  } else if (type === "FIXED_AMOUNT") {
    kind = "AMOUNT";
    variant = "FIXED";
    amount = Number(source.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "bad_amount" };
    }
  } else if (type === "SURPRISE_AMOUNT") {
    kind = "AMOUNT";
    variant = "FIXED";

    const minCents = toCents(source.surpriseMinAmount);
    const maxCents = toCents(source.surpriseMaxAmount);
    const midCents =
      source.surpriseMidAmount == null || source.surpriseMidAmount === ""
        ? minCents != null && maxCents != null
          ? defaultSurpriseMidCents(minCents, maxCents)
          : null
        : toCents(source.surpriseMidAmount);

    if (
      minCents == null ||
      midCents == null ||
      maxCents == null ||
      minCents <= 0 ||
      maxCents <= 0 ||
      minCents > maxCents ||
      midCents < minCents ||
      midCents > maxCents
    ) {
      return { error: "bad_surprise_amounts" };
    }

    surprise = {
      minCents,
      midCents,
      maxCents,
      minAmount: numberFromCents(minCents),
      midAmount: numberFromCents(midCents),
      maxAmount: numberFromCents(maxCents),
    };
  } else {
    return { error: "bad_type" };
  }

  return { kind, variant, percent, percentMin, percentMax, amount, surprise };
};

const shuffle = (items) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const buildSurpriseAmountAssignments = (total, surprise) => {
  if (!surprise || total <= 0) return [];

  const bucketCents = {
    min: surprise.minCents,
    mid: surprise.midCents,
    max: surprise.maxCents,
  };

  if (total < 5) {
    return shuffle(
      Array.from({ length: total }, () => ({
        bucket: "min",
        cents: bucketCents.min,
      }))
    );
  }

  if (total < 10) {
    return shuffle([
      ...Array.from({ length: total - 1 }, () => ({
        bucket: "min",
        cents: bucketCents.min,
      })),
      {
        bucket: "mid",
        cents: bucketCents.mid,
      },
    ]);
  }

  const planned = SURPRISE_DISTRIBUTION.map((bucket) => {
    const exact = (total * bucket.weight) / 100;
    return {
      ...bucket,
      exact,
      cents: bucketCents[bucket.key],
      count: Math.floor(exact),
      fraction: exact - Math.floor(exact),
    };
  });

  const bucketByKey = new Map(planned.map((bucket) => [bucket.key, bucket]));

  if (total >= 10 && bucketByKey.get("max")?.count === 0) {
    bucketByKey.get("max").count = 1;
  }

  if (total >= 5 && bucketByKey.get("mid")?.count === 0) {
    bucketByKey.get("mid").count = 1;
  }

  let remaining = total - planned.reduce((sum, bucket) => sum + bucket.count, 0);
  const tiePriority = { mid: 3, min: 2, max: 1 };

  if (remaining > 0) {
    const remainderOrder = [...planned].sort(
      (left, right) =>
        right.exact - right.count - (left.exact - left.count) ||
        (tiePriority[right.key] || 0) - (tiePriority[left.key] || 0)
    );

    for (let index = 0; remaining > 0; index = (index + 1) % remainderOrder.length) {
      remainderOrder[index].count += 1;
      remaining -= 1;
    }
  }

  while (remaining < 0) {
    const donor = [...planned]
      .filter((bucket) => bucket.count > 0)
      .sort((left, right) => left.weight - right.weight)[0];

    if (!donor) break;
    donor.count -= 1;
    remaining += 1;
  }

  const assignments = planned.flatMap((bucket) =>
    Array.from({ length: bucket.count }, () => ({
      bucket: bucket.key,
      cents: bucket.cents,
    }))
  );

  return shuffle(assignments);
};

async function genCouponCode(prisma, prefix) {
  let code;
  do {
    code = codePattern(prefix);
  } while (await prisma.coupon.findUnique({ where: { code } }));
  return code;
}

async function genCustomerCode(prisma) {
  let code;
  do {
    code = `CUS-${Math.floor(10000 + Math.random() * 90000)}`;
  } while (await prisma.customer.findUnique({ where: { code } }));
  return code;
}

async function findOrCreateCustomer(prisma, { partnerId, phone, name }) {
  const normalizedPhone = toE164ES(phone);
  const base9 = base9Phone(phone);
  if (!normalizedPhone || !base9) {
    throw new Error("invalid_phone");
  }

  const existing = await prisma.customer.findFirst({
    where: {
      partnerId,
      phone: { contains: base9 },
    },
  });

  if (existing) return existing;

  const code = await genCustomerCode(prisma);

  return prisma.customer.create({
    data: {
      partnerId,
      code,
      name: name || `Cliente ${base9}`,
      phone: normalizedPhone,
      address_1: `(GALLERY) ${normalizedPhone}`,
      portal: "COUPON_GALLERY",
      origin: "QR",
    },
  });
}

async function resolvePrivateRecipients(prisma, { partnerId, segments, activities, storeIds, zipCodes }) {
  const customers = [];
  const zipWhere = zipCodes.length
    ? {
        OR: zipCodes.flatMap((zipCode) => [
          { zipCode },
          { address_1: { contains: zipCode } },
        ]),
      }
    : null;

  if (segments.length || activities.length || storeIds.length || zipCodes.length) {
    const filteredCustomers = await prisma.customer.findMany({
      where: {
        partnerId,
        isRestricted: false,
        ...(segments.length ? { segment: { in: segments } } : {}),
        ...(activities.length ? { activity: { in: activities } } : {}),
        ...(storeIds.length ? { sales: { some: { storeId: { in: storeIds } } } } : {}),
        ...(zipWhere || {}),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        segment: true,
        activity: true,
        zipCode: true,
      },
    });

    customers.push(...filteredCustomers);
  }

  return uniqueCustomers(customers);
}

export default function couponsRoutes(prisma) {
  router.get("/gallery", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const zipCode = normalizeZipCode(req.query.zipCode);

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    try {
      const now = nowInTZ();
      const rows = await prisma.coupon.findMany({
        where: {
          partnerId,
          status: "ACTIVE",
          visibility: "PUBLIC",
        },
        orderBy: { createdAt: "desc" },
      });
      const scopedRows = rows.filter(
        (coupon) => !hasSegmentTargeting(coupon) && matchesCouponTerritory(coupon, zipCode)
      );

      const groups = new Map();

      scopedRows.forEach((coupon) => {
        const type = buildCouponType(coupon);
        const key = buildCouponKey(coupon);
        const mapKey = `${type}:${key}`;
        const usedCount = toNum(coupon.usedCount) ?? 0;
        const usageLimit = toNum(coupon.usageLimit);
        const available =
          coupon.assignedToId == null &&
          isActiveByDate(coupon, now) &&
          isWithinWindow(coupon, now) &&
          (usageLimit == null || usageLimit > usedCount);

        const current = groups.get(mapKey) || {
          type,
          key,
          title: buildCouponTitle(coupon),
          subtitle:
            type === "FIXED_AMOUNT" || type === "SURPRISE_AMOUNT"
              ? "Canjea y descubre"
              : "Descuento para tu pedido",
          cta: "Canjear",
          remaining: 0,
          sample: coupon,
        };

        if (available) {
          if (usageLimit == null) current.remaining = null;
          else if (current.remaining !== null) current.remaining += Math.max(0, usageLimit - usedCount);
        }

        if (!current.sample || new Date(coupon.createdAt) > new Date(current.sample.createdAt)) {
          current.sample = coupon;
        }

        groups.set(mapKey, current);
      });

      const cards = Array.from(groups.values())
        .map((group) => ({
          type: group.type,
          key: group.key,
          title: group.title,
          subtitle: group.subtitle,
          cta: group.cta,
          remaining: group.remaining,
          constraints: {
            daysActive: normalizeDaysActive(group.sample.daysActive),
            windowStart: group.sample.windowStart,
            windowEnd: group.sample.windowEnd,
          },
          lifetime: {
            activeFrom: group.sample.activeFrom,
            expiresAt: group.sample.expiresAt,
          },
          visibility: group.sample.visibility,
          acquisition: group.sample.acquisition,
          channel: group.sample.channel,
          campaign: group.sample.campaign,
          isSegmented: hasSegmentTargeting(group.sample),
        }))
        .sort((left, right) => String(left.title).localeCompare(String(right.title), "es"));

      return res.json({
        ok: true,
        partnerId,
        zipCode,
        cards,
      });
    } catch (error) {
      console.error("[coupons.gallery] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.get("/gallery-context", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const latitude = toNullableFloat(req.query.lat);
    const longitude = toNullableFloat(req.query.lng);

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    try {
      const [rows, stores] = await Promise.all([
        prisma.coupon.findMany({
          where: {
            partnerId,
            status: "ACTIVE",
            visibility: "PUBLIC",
          },
          select: {
            meta: true,
            segments: true,
          },
        }),
        prisma.store.findMany({
          where: { partnerId, active: true },
          select: {
            id: true,
            storeName: true,
            city: true,
            zipCode: true,
            latitude: true,
            longitude: true,
          },
        }),
      ]);

      const zipSet = new Set();

      rows.filter((coupon) => !hasSegmentTargeting(coupon)).forEach((coupon) => {
        const { zipCodes, targetStores } = readCouponTargeting(coupon);
        zipCodes.forEach((zipCode) => zipSet.add(zipCode));
        targetStores.forEach((store) => {
          if (store.zipCode) zipSet.add(store.zipCode);
        });
      });

      stores.forEach((store) => {
        const zipCode = normalizeZipCode(store.zipCode);
        if (zipCode) zipSet.add(zipCode);
      });

      const zipCodes = [...zipSet].sort((left, right) => String(left).localeCompare(String(right), "es"));

      let resolvedZipCode = null;
      let resolvedStore = null;

      if (latitude != null && longitude != null) {
        const nearestStore = stores
          .map((store) => ({
            ...store,
            zipCode: normalizeZipCode(store.zipCode),
            latitude: toNullableFloat(store.latitude),
            longitude: toNullableFloat(store.longitude),
          }))
          .filter((store) => store.zipCode && store.latitude != null && store.longitude != null)
          .map((store) => ({
            ...store,
            distanceKm: haversineKm(latitude, longitude, store.latitude, store.longitude),
          }))
          .sort((left, right) => left.distanceKm - right.distanceKm)[0];

        if (nearestStore) {
          resolvedZipCode = nearestStore.zipCode;
          resolvedStore = {
            id: nearestStore.id,
            storeName: nearestStore.storeName,
            city: nearestStore.city,
            zipCode: nearestStore.zipCode,
            distanceKm: Number(nearestStore.distanceKm.toFixed(2)),
          };
        }
      }

      return res.json({
        ok: true,
        partnerId,
        zipCodes,
        resolvedZipCode,
        resolvedStore,
      });
    } catch (error) {
      console.error("[coupons.gallery-context] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/bulk-generate", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    const type = String(req.body.type || "").toUpperCase();

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, error: "bad_type" });
    }

    const quantity = Math.max(1, Math.min(parsePositiveInt(req.body.quantity) || 1, 1000));
    const usageLimit = Math.max(1, parsePositiveInt(req.body.usageLimit) || 1);
    const requestedVisibility = String(
      req.body.visibility == null
        ? req.body.isVisible === false
          ? "RESERVED"
          : "PUBLIC"
        : req.body.visibility
    ).toUpperCase();
    const isVisible = !["RESERVED", "PRIVATE"].includes(requestedVisibility);
    const visibility = isVisible ? "PUBLIC" : "RESERVED";
    const { segments: requestedSegments, activities: requestedActivities } = splitTargetTags(req.body.segments);
    if (isVisible && (requestedSegments.length || requestedActivities.length)) {
      return res.status(400).json({ ok: false, error: "public_coupons_cannot_have_segments" });
    }

    const segments = isVisible ? [] : requestedSegments;
    const activities = isVisible ? [] : requestedActivities;
    const storeIds = normalizeStoreIds(req.body.storeIds);
    const zipCodes = normalizeZipCodes(req.body.zipCodes);
    const targetTags = [...segments, ...activities];
    const daysActive = normalizeDaysActive(req.body.daysActive || null);
    const windowStart = req.body.windowStart == null || req.body.windowStart === "" ? null : Number(req.body.windowStart);
    const windowEnd = req.body.windowEnd == null || req.body.windowEnd === "" ? null : Number(req.body.windowEnd);
    const minAmount = parseDecimal(req.body.minAmount);

    const definition = parseCouponDefinition(type, req.body);
    if (definition.error) {
      return res.status(400).json({ ok: false, error: definition.error });
    }

    const { kind, variant, percent, percentMin, percentMax, amount, surprise } = definition;

    if (minAmount != null && minAmount < 0) {
      return res.status(400).json({ ok: false, error: "bad_min_amount" });
    }

    try {
      const prefix = PREFIX[type];
      let recipients = [];
      let totalToCreate = quantity;
      let targetStores = [];

      if (storeIds.length) {
        targetStores = await prisma.store.findMany({
          where: {
            partnerId,
            id: { in: storeIds },
          },
          select: {
            id: true,
            storeName: true,
            city: true,
            zipCode: true,
          },
        });

        if (targetStores.length !== storeIds.length) {
          return res.status(400).json({ ok: false, error: "bad_store_ids" });
        }
      }

      if (!isVisible) {
        recipients = await resolvePrivateRecipients(prisma, {
          partnerId,
          segments,
          activities,
          storeIds,
          zipCodes,
        });

        if (!recipients.length) {
          return res.status(400).json({ ok: false, error: "no_recipients" });
        }

        totalToCreate = recipients.length;
      }

      const codes = [];
      while (codes.length < totalToCreate) {
        const code = await genCouponCode(prisma, prefix);
        codes.push(code);
      }

      const surpriseAssignments =
        type === "SURPRISE_AMOUNT" ? buildSurpriseAmountAssignments(totalToCreate, surprise) : [];

      const rows = codes.map((code, index) => {
        const randomPercent =
          type === "RANDOM_PERCENT"
            ? Math.floor(Math.random() * (percentMax - percentMin + 1)) + percentMin
            : null;
        const surpriseAssignment = surpriseAssignments[index] || null;
        const targetCustomer = !isVisible ? recipients[index] : null;
        const targeting =
          segments.length || activities.length || storeIds.length || zipCodes.length
            ? {
                segments,
                activities,
                storeIds,
                zipCodes,
              }
            : null;
        const meta = {
          ...(req.body.notes ? { notes: String(req.body.notes) } : {}),
          ...(targeting ? { targeting } : {}),
          ...(targetStores.length
            ? {
                targetStores: targetStores.map((store) => ({
                  id: store.id,
                  storeName: store.storeName,
                  city: store.city,
                  zipCode: store.zipCode,
                })),
              }
            : {}),
          ...(targetCustomer
            ? {
                targetCustomerId: targetCustomer.id,
                targetCustomerName: targetCustomer.name || null,
                targetCustomerSegment: targetCustomer.segment || null,
                targetCustomerActivity: targetCustomer.activity || null,
                targetCustomerZipCode: targetCustomer.zipCode || null,
              }
            : {}),
          ...(surprise
            ? {
                surpriseAmount: {
                  minAmount: surprise.minAmount,
                  midAmount: surprise.midAmount,
                  maxAmount: surprise.maxAmount,
                  weights: {
                    min: 75,
                    mid: 15,
                    max: 10,
                  },
                  assignedBucket: surpriseAssignment?.bucket || null,
                  assignedAmount:
                    surpriseAssignment?.cents != null ? numberFromCents(surpriseAssignment.cents) : null,
                },
              }
            : {}),
        };

        return {
          partnerId,
          code,
          kind,
          variant,
          percent: type === "RANDOM_PERCENT" ? randomPercent : percent,
          ...(minAmount != null && minAmount > 0 ? { minAmount: toMoney(minAmount) } : {}),
          percentMin,
          percentMax,
          amount:
            surpriseAssignment?.cents != null
              ? moneyFromCents(surpriseAssignment.cents)
              : amount != null
                ? String(amount.toFixed(2))
                : null,
          maxAmount: toMoney(req.body.maxAmount),
          segments: targetTags.length ? targetTags : null,
          assignedToId: targetCustomer?.id || null,
          visibility,
          activeFrom: req.body.activeFrom ? new Date(req.body.activeFrom) : null,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
          daysActive: daysActive.length ? daysActive : null,
          windowStart,
          windowEnd,
          usageLimit,
          status: "ACTIVE",
          campaign: type === "SURPRISE_AMOUNT" ? SURPRISE_AMOUNT_CAMPAIGN : req.body.campaign || null,
          channel: req.body.channel ? String(req.body.channel).toUpperCase() : null,
          acquisition: req.body.acquisition
            ? String(req.body.acquisition).toUpperCase()
            : isVisible
              ? null
              : "DIRECT",
          gameId: req.body.gameId ? Number(req.body.gameId) : null,
          meta: Object.keys(meta).length ? meta : null,
        };
      });

      await prisma.coupon.createMany({ data: rows, skipDuplicates: true });

      return res.json({
        ok: true,
        created: rows.length,
        visibility,
        recipients: recipients.length,
        surpriseDistribution:
          type === "SURPRISE_AMOUNT"
            ? surpriseAssignments.reduce(
                (summary, item) => ({
                  ...summary,
                  [item.bucket]: (summary[item.bucket] || 0) + 1,
                }),
                { min: 0, mid: 0, max: 0 }
              )
            : null,
        targeting: {
          storeIds,
          zipCodes,
          segments,
          activities,
        },
        sample: rows.slice(0, 10).map((row) => row.code),
      });
    } catch (error) {
      console.error("[coupons.bulk-generate] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/push-customer", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    const customerId = parsePositiveInt(req.body.customerId);
    const type = String(req.body.type || "").toUpperCase();
    const minAmount = parseDecimal(req.body.minAmount);

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    if (!customerId) {
      return res.status(400).json({ ok: false, error: "customerId required" });
    }

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, error: "bad_type" });
    }

    if (!req.body.expiresAt) {
      return res.status(400).json({ ok: false, error: "expiresAt required" });
    }

    const definition = parseCouponDefinition(type, req.body);
    if (definition.error) {
      return res.status(400).json({ ok: false, error: definition.error });
    }

    if (minAmount != null && minAmount < 0) {
      return res.status(400).json({ ok: false, error: "bad_min_amount" });
    }

    try {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          partnerId,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          segment: true,
          activity: true,
          isRestricted: true,
        },
      });

      if (!customer) {
        return res.status(404).json({ ok: false, error: "customer_not_found" });
      }

      if (customer.isRestricted) {
        return res.status(409).json({ ok: false, error: "customer_restricted" });
      }

      const code = await genCouponCode(prisma, PREFIX[type]);
      const { kind, variant, percent, percentMin, percentMax, amount, surprise } = definition;
      const surpriseAssignment =
        type === "SURPRISE_AMOUNT" ? buildSurpriseAmountAssignments(1, surprise)[0] : null;

      const created = await prisma.coupon.create({
        data: {
          partnerId,
          code,
          kind,
          variant,
          percent,
          percentMin,
          percentMax,
          amount:
            surpriseAssignment?.cents != null
              ? moneyFromCents(surpriseAssignment.cents)
              : amount != null
                ? String(amount.toFixed(2))
                : null,
          ...(minAmount != null && minAmount > 0 ? { minAmount: toMoney(minAmount) } : {}),
          maxAmount: toMoney(req.body.maxAmount),
          assignedToId: customer.id,
          visibility: "RESERVED",
          status: "ACTIVE",
          acquisition: "DIRECT",
          channel: "CRM",
          campaign: type === "SURPRISE_AMOUNT" ? SURPRISE_AMOUNT_CAMPAIGN : null,
          usageLimit: 1,
          usedCount: 0,
          expiresAt: new Date(req.body.expiresAt),
          segments: [customer.segment, customer.activity].filter(Boolean),
          meta: {
            ...(req.body.notes ? { notes: String(req.body.notes) } : {}),
            targetCustomerId: customer.id,
            targetCustomerName: customer.name || null,
            targetCustomerSegment: customer.segment || null,
            targetCustomerActivity: customer.activity || null,
            messageStatus: "pending",
            ...(surprise
              ? {
                  surpriseAmount: {
                    minAmount: surprise.minAmount,
                    midAmount: surprise.midAmount,
                    maxAmount: surprise.maxAmount,
                    weights: {
                      min: 75,
                      mid: 15,
                      max: 10,
                    },
                    assignedBucket: surpriseAssignment?.bucket || null,
                    assignedAmount:
                      surpriseAssignment?.cents != null ? numberFromCents(surpriseAssignment.cents) : null,
                  },
                }
              : {}),
          },
        },
      });

      return res.json({
        ok: true,
        coupon: {
          id: created.id,
          code: created.code,
          title: buildCouponTitle(created),
          expiresAt: created.expiresAt,
        },
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
        },
        delivery: {
          status: "pending",
          channel: "CRM",
        },
      });
    } catch (error) {
      console.error("[coupons.push-customer] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.get("/metrics", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 864e5);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const segment = req.query.segment ? String(req.query.segment).toUpperCase() : "";

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    try {
      const couponWhere = {
        partnerId,
        createdAt: { gte: from, lte: to },
      };

      const redemptionWhere = {
        partnerId,
        redeemedAt: { gte: from, lte: to },
        ...(segment ? { segmentAtRedeem: segment } : {}),
      };

      const [issued, redemptions] = await Promise.all([
        prisma.coupon.count(couponWhere ? { where: couponWhere } : undefined),
        prisma.couponRedemption.findMany({
          where: redemptionWhere,
          select: {
            couponCode: true,
            redeemedAt: true,
            kind: true,
            discountValue: true,
            segmentAtRedeem: true,
          },
          orderBy: { redeemedAt: "asc" },
        }),
      ]);

      const byKindMap = new Map();
      const byCodeMap = new Map();
      const bySegmentMap = new Map();
      const byDayMap = new Map();

      let discountTotal = 0;

      redemptions.forEach((item) => {
        const kind = item.kind || "UNKNOWN";
        byKindMap.set(kind, (byKindMap.get(kind) || 0) + 1);
        byCodeMap.set(item.couponCode, (byCodeMap.get(item.couponCode) || 0) + 1);
        if (item.segmentAtRedeem) {
          bySegmentMap.set(item.segmentAtRedeem, (bySegmentMap.get(item.segmentAtRedeem) || 0) + 1);
        }
        const day = new Date(item.redeemedAt).toISOString().slice(0, 10);
        byDayMap.set(day, (byDayMap.get(day) || 0) + 1);
        discountTotal += toNum(item.discountValue) || 0;
      });

      const dailySpark = [];
      for (let time = new Date(from); time <= to; time = new Date(time.getTime() + 864e5)) {
        const day = time.toISOString().slice(0, 10);
        dailySpark.push({ day, value: byDayMap.get(day) || 0 });
      }

      return res.json({
        ok: true,
        kpi: {
          issued,
          redeemed: redemptions.length,
          redemptionRate: issued > 0 ? redemptions.length / issued : null,
          discountTotal,
          byKind: Array.from(byKindMap.entries()).map(([kind, count]) => ({ kind, count })),
          byCodeTop: Array.from(byCodeMap.entries())
            .map(([code, count]) => ({ code, count }))
            .sort((left, right) => right.count - left.count)
            .slice(0, 5),
          bySegment: Array.from(bySegmentMap.entries()).map(([segmentKey, count]) => ({
            segment: segmentKey,
            count,
            penetration: redemptions.length ? count / redemptions.length : 0,
          })),
          dailySpark,
        },
      });
    } catch (error) {
      console.error("[coupons.metrics] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.get("/redemptions", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const take = Math.max(1, Math.min(parsePositiveInt(req.query.take) || 25, 100));
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    try {
      const where = {
        partnerId,
      };

      const [items, total] = await Promise.all([
        prisma.couponRedemption.findMany({
          where,
          take,
          skip,
          orderBy: { redeemedAt: "desc" },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                segment: true,
              },
            },
            coupon: {
              select: {
                code: true,
              },
            },
          },
        }),
        prisma.couponRedemption.count({ where }),
      ]);

      return res.json({ ok: true, total, items });
    } catch (error) {
      console.error("[coupons.redemptions] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/direct-claim", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    const type = String(req.body.type || "").toUpperCase();
    const key = String(req.body.key || "").trim();
    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").trim();
    const zipCode = normalizeZipCode(req.body.zipCode);

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone required" });
    }

    if (!zipCode) {
      return res.status(400).json({ ok: false, error: "zipCode required" });
    }

    const typeWhere = buildTypeWhere(type, key);
    if (!typeWhere) {
      return res.status(400).json({ ok: false, error: "bad_coupon_type" });
    }

    try {
      const customer = await findOrCreateCustomer(prisma, { partnerId, phone, name });
      const now = nowInTZ();
      const candidates = await prisma.coupon.findMany({
        where: {
          partnerId,
          visibility: "PUBLIC",
          status: "ACTIVE",
          assignedToId: null,
          ...typeWhere,
        },
        orderBy: { createdAt: "asc" },
      });
      const coupon = candidates.find(
        (candidate) =>
          !hasSegmentTargeting(candidate) &&
          buildCouponKey(candidate) === key &&
          matchesCouponTerritory(candidate, zipCode) &&
          customerMatchesCouponTargetTags(customer, candidate) &&
          isActiveByDate(candidate, now) &&
          isWithinWindow(candidate, now)
      );

      if (!coupon) {
        const hasTerritorialCandidates = candidates.some((candidate) => hasTerritorialTargeting(candidate));
        const hasSegmentCandidates = candidates.some((candidate) => !customerMatchesCouponTargetTags(customer, candidate));
        return res.status(409).json({
          ok: false,
          error: hasTerritorialCandidates
            ? "unavailable_in_area"
            : hasSegmentCandidates
              ? "segment_not_eligible"
              : "out_of_stock",
        });
      }

      const expiresAt = coupon.expiresAt || new Date(now.getTime() + 48 * 3600 * 1000);

      const updated = await prisma.coupon.update({
        where: { id: coupon.id },
        data: {
          assignedToId: customer.id,
          visibility: "RESERVED",
          acquisition: "CLAIM",
          channel: "WEB",
          expiresAt,
        },
      });

      return res.json({
        ok: true,
        coupon: {
          code: updated.code,
          title: buildCouponTitle(updated),
          expiresAt: updated.expiresAt,
        },
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
        },
      });
    } catch (error) {
      console.error("[coupons.direct-claim] error:", error);
      return res.status(500).json({ ok: false, error: error.message === "invalid_phone" ? "invalid_phone" : "server" });
    }
  });

  return router;
}
