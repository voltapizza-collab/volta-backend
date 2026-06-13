import express from "express";
import { getBoostSettings } from "../services/boostSettings.js";
import { sendOrderCustomerMessageSms, sendOrderReadySms } from "../services/orderNotifications.js";
import { createProductReviewRequestForSale } from "../services/productReviews.js";
import { createBoostCheckoutSession, isStripeCheckoutConfigured } from "../services/stripe.js";
import {
  normalizeCustomerSegment,
  VIP_CUSTOMER_SEGMENT,
} from "../services/customerSegments.js";
import { createTtlCache } from "../services/responseCache.js";

const TZ = process.env.TIMEZONE || "Europe/Madrid";
const WEEKDAY_LABELS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const boundedInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  const safeValue = Number.isInteger(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(safeValue, max));
};
const CUSTOMER_RECENT_SALES_TAKE = boundedInt(
  process.env.MYORDERS_CUSTOMER_RECENT_SALES_TAKE,
  20,
  1,
  100
);
const SUMMARY_HISTORY_DAYS = boundedInt(
  process.env.MYORDERS_SUMMARY_HISTORY_DAYS,
  180,
  30,
  730
);
const SUMMARY_HISTORY_MAX_ROWS = boundedInt(
  process.env.MYORDERS_SUMMARY_HISTORY_MAX_ROWS,
  5000,
  500,
  50_000
);
const pendingOrdersCache = createTtlCache({
  name: "myorders-pending",
  ttlMs: Number(process.env.MYORDERS_PENDING_CACHE_MS || 2_000),
  maxEntries: Number(process.env.MYORDERS_PENDING_CACHE_MAX || 500),
});
const summaryCache = createTtlCache({
  name: "myorders-summary",
  ttlMs: Number(process.env.MYORDERS_SUMMARY_CACHE_MS || 15_000),
  maxEntries: Number(process.env.MYORDERS_SUMMARY_CACHE_MAX || 500),
});

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseOptionalDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const nowInTZ = () => {
  const snapshot = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  return new Date(snapshot.replace(" ", "T"));
};

const getLocalDateParts = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const key = `${parts.year}-${parts.month}-${parts.day}`;
  const localDate = new Date(`${key}T00:00:00Z`);
  const weekday = localDate.getUTCDay();

  return {
    key,
    isoDate: key,
    dayOfMonth: Number(parts.day),
    weekday,
    weekdayLabel: WEEKDAY_LABELS[weekday],
  };
};

const getLocalHour = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const hour = Number(parts.hour);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
};

const startOfLocalDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const subtractDays = (date, days) => addDays(date, -days);

const startOfLocalWeek = (date) => {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return startOfLocalDay(addDays(date, mondayOffset));
};

const getPeriodRange = (period) => {
  const now = nowInTZ();

  if (period === "week") {
    const from = startOfLocalWeek(now);
    return {
      from,
      to: addDays(from, 7),
      label: "Semana actual",
    };
  }

  const from = startOfLocalDay(now);
  return {
    from,
    to: addDays(from, 1),
    label: "Hoy",
  };
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

const asArray = (value) => {
  const first = parseMaybeJson(value, []);
  const second = parseMaybeJson(first, []);
  return Array.isArray(second) ? second : [];
};

const asObject = (value) => {
  const parsed = parseMaybeJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

const getLineQty = (item) => {
  const qty = Number(item?.quantity ?? item?.qty ?? item?.cantidad ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
};

const countSaleProductUnits = (sale) => {
  const items = asArray(sale?.products);
  if (!items.length) return 1;

  const units = items.reduce((sum, item) => sum + getLineQty(item), 0);
  return units > 0 ? units : 1;
};

const cleanChatText = (value) => String(value || "").trim().replace(/\s+/g, " ");

const getChatMessages = (customerData) => {
  const data = asObject(customerData);
  const messages = Array.isArray(data.chatMessages) ? data.chatMessages : [];

  return messages
    .map((message) => ({
      id: String(message?.id || ""),
      sender: String(message?.sender || "").toUpperCase() === "CUSTOMER" ? "CUSTOMER" : "OPERATOR",
      text: cleanChatText(message?.text).slice(0, 600),
      createdAt: message?.createdAt || null,
      readAt: message?.readAt || null,
    }))
    .filter((message) => message.id && message.text);
};

const appendChatMessage = (customerData, message) => {
  const data = asObject(customerData);
  const messages = getChatMessages(data);

  return {
    ...data,
    chatMessages: [...messages, message].slice(-50),
    chatUpdatedAt: message.createdAt,
  };
};

const markCustomerChatMessagesRead = (customerData) => {
  const readAt = new Date().toISOString();
  const data = asObject(customerData);
  const messages = getChatMessages(data).map((message) =>
    message.sender === "CUSTOMER" && !message.readAt
      ? { ...message, readAt }
      : message
  );

  return {
    ...data,
    chatMessages: messages,
    chatReadAt: readAt,
  };
};

const getScheduledFor = (sale) => {
  const customerData = asObject(sale.customerData);
  const scheduledFor = parseOptionalDate(
    customerData.scheduledFor || customerData.delivery?.scheduledFor
  );

  return scheduledFor ? scheduledFor.toISOString() : null;
};

const normalizeSalePaymentMode = (sale, customerData = asObject(sale?.customerData)) => {
  const rawMode = String(
    customerData.paymentMode ||
      customerData.paymentMethod ||
      customerData.payment_type ||
      sale?.paymentMode ||
      sale?.paymentMethod ||
      ""
  )
    .trim()
    .toLowerCase();
  const rawStatus = String(customerData.paymentStatus || sale?.paymentStatus || "").trim().toLowerCase();

  if (rawMode === "cash" || rawMode === "efectivo" || rawStatus.includes("cash")) return "cash";
  if (
    rawMode === "card" ||
    rawMode === "tarjeta" ||
    rawMode === "stripe" ||
    rawMode === "stripe_checkout" ||
    rawStatus.includes("card") ||
    rawStatus.includes("stripe") ||
    sale?.stripePaymentIntentId ||
    sale?.stripeCheckoutSessionId
  ) {
    return "card";
  }

  return "";
};

const normalizeSalePaymentStatus = (sale, customerData = asObject(sale?.customerData)) => {
  const rawStatus = String(customerData.paymentStatus || sale?.paymentStatus || "").trim();
  if (rawStatus) return rawStatus;

  const mode = normalizeSalePaymentMode(sale, customerData);
  if (mode === "cash") return "cash_pending";
  if (mode === "card") return sale?.status === "AWAITING_PAYMENT" ? "awaiting_card_payment" : "card_paid";
  return "";
};

export { normalizeSalePaymentMode };

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const toCents = (value) => Math.round(roundMoney(value) * 100);

const average = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const summarizeDailySales = (sales) => {
  const dailyMap = new Map();

  sales.forEach((sale) => {
    const total = Number(sale.total || 0);
    if (!Number.isFinite(total)) return;

    const parts = getLocalDateParts(sale.date || sale.createdAt);
    if (!parts) return;

    const row = dailyMap.get(parts.key) || {
      ...parts,
      revenue: 0,
      orders: 0,
    };
    row.revenue += total;
    row.orders += 1;
    dailyMap.set(parts.key, row);
  });

  return [...dailyMap.values()].filter((row) => row.revenue > 0);
};

const summarizeCalendarGroup = (rows, keyName) => {
  const buckets = new Map();

  rows.forEach((row) => {
    const key = row[keyName];
    const bucket = buckets.get(key) || { count: 0, revenue: 0 };
    bucket.count += 1;
    bucket.revenue += row.revenue;
    buckets.set(key, bucket);
  });

  return buckets;
};

const summarizeCalendarRankings = (buckets, labelForKey) =>
  [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: labelForKey(key),
      averageRevenue: bucket.count ? bucket.revenue / bucket.count : 0,
      samples: bucket.count || 0,
    }))
    .filter((row) => row.averageRevenue > 0)
    .sort(
      (left, right) =>
        right.averageRevenue - left.averageRevenue ||
        right.samples - left.samples ||
        String(left.label).localeCompare(String(right.label))
    );

const getCalendarAverage = (buckets, key, fallbackAverage) => {
  const bucket = buckets.get(key);
  if (!bucket || !bucket.count) {
    return {
      averageRevenue: fallbackAverage,
      count: 0,
    };
  }

  return {
    averageRevenue: bucket.revenue / bucket.count,
    count: bucket.count,
  };
};

const pickCalendarWeights = ({ weekdayAverage, monthdayAverage }) => {
  if (weekdayAverage <= 0 && monthdayAverage <= 0) {
    return { weekday: 0.5, monthday: 0.5, stronger: "none" };
  }

  const total = weekdayAverage + monthdayAverage;
  const weekday = total > 0 ? weekdayAverage / total : 0.5;
  const monthday = total > 0 ? monthdayAverage / total : 0.5;

  return {
    weekday,
    monthday,
    stronger:
      monthdayAverage > weekdayAverage
        ? "monthday"
        : weekdayAverage > monthdayAverage
        ? "weekday"
        : "tie",
  };
};

const buildCalendarIndicators = (sales, now = nowInTZ()) => {
  const dailyRows = summarizeDailySales(sales);
  const baseDailyRevenue = average(dailyRows.map((row) => row.revenue));
  const weekdayBuckets = summarizeCalendarGroup(dailyRows, "weekday");
  const monthdayBuckets = summarizeCalendarGroup(dailyRows, "dayOfMonth");
  const weekdayRankings = summarizeCalendarRankings(
    weekdayBuckets,
    (key) => WEEKDAY_LABELS[Number(key)] || String(key)
  );
  const monthdayRankings = summarizeCalendarRankings(monthdayBuckets, (key) => `dia ${key}`);
  const topWeekdayKeys = new Set(weekdayRankings.slice(0, 3).map((row) => row.key));
  const topMonthdayKeys = new Set(monthdayRankings.slice(0, 3).map((row) => row.key));

  const describeDate = (date) => {
    const parts = getLocalDateParts(date);
    const weekday = getCalendarAverage(weekdayBuckets, parts.weekday, baseDailyRevenue);
    const monthday = getCalendarAverage(monthdayBuckets, parts.dayOfMonth, baseDailyRevenue);
    const weights = pickCalendarWeights({
      weekdayAverage: weekday.averageRevenue,
      monthdayAverage: monthday.averageRevenue,
    });
    const expectedRevenue =
      weights.weekday * weekday.averageRevenue + weights.monthday * monthday.averageRevenue;
    const calendarIndex = baseDailyRevenue > 0 ? expectedRevenue / baseDailyRevenue : 0;
    const isTopWeekday = topWeekdayKeys.has(parts.weekday);
    const isTopMonthday = topMonthdayKeys.has(parts.dayOfMonth);

    return {
      date: parts.isoDate,
      dayOfMonth: parts.dayOfMonth,
      weekday: parts.weekday,
      weekdayLabel: parts.weekdayLabel,
      expectedRevenue: roundMoney(expectedRevenue),
      potentialScore: roundMoney(calendarIndex * 100),
      calendarIndex,
      weekdayAverage: roundMoney(weekday.averageRevenue),
      monthdayAverage: roundMoney(monthday.averageRevenue),
      weekdaySamples: weekday.count,
      monthdaySamples: monthday.count,
      isTopWeekday,
      isTopMonthday,
      tramoLevel: isTopWeekday && isTopMonthday ? "cross" : isTopWeekday || isTopMonthday ? "strong" : "normal",
      tramoReason:
        isTopWeekday && isTopMonthday
          ? "Cruce fuerte"
          : isTopWeekday
          ? "Dia semana fuerte"
          : isTopMonthday
          ? "Dia mes fuerte"
          : "Potencial normal",
      weights: {
        weekday: weights.weekday,
        monthday: weights.monthday,
        weekdayPct: Math.round(weights.weekday * 100),
        monthdayPct: Math.round(weights.monthday * 100),
        stronger: weights.stronger,
      },
    };
  };

  const today = startOfLocalDay(now);
  const upcomingDays = Array.from({ length: 14 }, (_, index) => describeDate(addDays(today, index)));
  const topUpcomingDays = [...upcomingDays]
    .filter((day) => day.expectedRevenue > 0)
    .sort((left, right) => {
      const levelDiff =
        (right.tramoLevel === "cross" ? 2 : right.tramoLevel === "strong" ? 1 : 0) -
        (left.tramoLevel === "cross" ? 2 : left.tramoLevel === "strong" ? 1 : 0);
      if (levelDiff) return levelDiff;
      return right.expectedRevenue - left.expectedRevenue || new Date(left.date) - new Date(right.date);
    })
    .slice(0, 8);

  return {
    baseDailyRevenue: roundMoney(baseDailyRevenue),
    sampleDays: dailyRows.length,
    expectedToday: describeDate(today),
    upcomingDays,
    topUpcomingDays,
    rankings: {
      weekdays: weekdayRankings.slice(0, 7).map((row) => ({
        ...row,
        averageRevenue: roundMoney(row.averageRevenue),
      })),
      monthdays: monthdayRankings.slice(0, 10).map((row) => ({
        ...row,
        averageRevenue: roundMoney(row.averageRevenue),
      })),
    },
  };
};

const HEATMAP_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const normalizeStoreHourWindow = (slot) => {
  const weekday = Number(slot?.dayOfWeek);
  const openTime = Number(slot?.openTime);
  const closeTime = Number(slot?.closeTime);

  if (
    !Number.isInteger(weekday) ||
    weekday < 0 ||
    weekday > 6 ||
    !Number.isFinite(openTime) ||
    !Number.isFinite(closeTime)
  ) {
    return null;
  }

  return {
    storeId: parsePositiveInt(slot?.storeId),
    weekday,
    openTime: Math.max(0, Math.trunc(openTime)),
    closeTime: Math.max(0, Math.trunc(closeTime)),
  };
};

const hourOverlapsWindow = (hour, openTime, closeTime) => {
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;
  return hourStart < closeTime && hourEnd > openTime;
};

const buildScheduleMatrix = (storeHours = []) => {
  const openKeys = new Set();
  const storeOpenKeys = new Set();
  const scheduledStoreIds = new Set();
  const openHours = new Set();

  storeHours.map(normalizeStoreHourWindow).filter(Boolean).forEach((slot) => {
    const windows = [{ weekday: slot.weekday, openTime: slot.openTime, closeTime: slot.closeTime }];

    if (slot.closeTime <= slot.openTime) {
      windows[0].closeTime = 24 * 60;
      windows.push({
        weekday: (slot.weekday + 1) % 7,
        openTime: 0,
        closeTime: slot.closeTime,
      });
    }

    windows.forEach((window) => {
      for (let hour = 0; hour < 24; hour += 1) {
        if (!hourOverlapsWindow(hour, window.openTime, window.closeTime)) continue;
        const openKey = `${window.weekday}:${hour}`;
        openKeys.add(openKey);
        if (slot.storeId) {
          storeOpenKeys.add(`${slot.storeId}:${openKey}`);
          scheduledStoreIds.add(slot.storeId);
        }
        openHours.add(hour);
      }
    });
  });

  return {
    hasSchedule: openKeys.size > 0,
    openKeys,
    storeOpenKeys,
    scheduledStoreIds,
    openHours,
  };
};

const buildTrafficHeatmap = (sales, calendarIndicators, storeHours = [], now = nowInTZ()) => {
  const cellMap = new Map();
  const weekdayMap = new Map();
  const activeHours = new Set();
  const schedule = buildScheduleMatrix(storeHours);
  let sampleOrders = 0;
  let sampleProducts = 0;

  sales.forEach((sale) => {
    const total = Number(sale.total || 0);
    if (!Number.isFinite(total)) return;

    const value = sale.date || sale.createdAt;
    const parts = getLocalDateParts(value);
    const hour = getLocalHour(value);
    if (!parts || hour == null) return;

    const scheduleKey = `${parts.weekday}:${hour}`;
    const saleStoreId = parsePositiveInt(sale.storeId);
    if (
      schedule.hasSchedule &&
      saleStoreId &&
      schedule.scheduledStoreIds.has(saleStoreId) &&
      !schedule.storeOpenKeys.has(`${saleStoreId}:${scheduleKey}`)
    ) {
      return;
    }

    const key = `${parts.weekday}:${hour}`;
    const cell = cellMap.get(key) || {
      weekday: parts.weekday,
      hour,
      orders: 0,
      products: 0,
      revenue: 0,
    };
    const productUnits = countSaleProductUnits(sale);
    cell.orders += 1;
    cell.products += productUnits;
    cell.revenue += total;
    cellMap.set(key, cell);

    const weekday = weekdayMap.get(parts.weekday) || {
      weekday: parts.weekday,
      orders: 0,
      products: 0,
      revenue: 0,
    };
    weekday.orders += 1;
    weekday.products += productUnits;
    weekday.revenue += total;
    weekdayMap.set(parts.weekday, weekday);

    activeHours.add(hour);
    sampleOrders += 1;
    sampleProducts += productUnits;
  });

  const scheduledHours = [...schedule.openHours].sort((left, right) => left - right);
  const observedHours = [...activeHours].sort((left, right) => left - right);
  const hours = schedule.hasSchedule
    ? scheduledHours
    : Array.from(
        {
          length:
            (observedHours.length ? Math.max(observedHours[observedHours.length - 1], 23) : 23) -
            (observedHours.length ? Math.min(observedHours[0], 11) : 11) +
            1,
        },
        (_, index) => index + (observedHours.length ? Math.min(observedHours[0], 11) : 11)
      );

  const maxProducts = Math.max(1, ...[...cellMap.values()].map((cell) => cell.products));
  const topKeys = new Set(
    [...cellMap.values()]
      .sort(
        (left, right) =>
          right.products - left.products ||
          right.orders - left.orders ||
          right.revenue - left.revenue
      )
      .slice(0, 3)
      .map((cell) => `${cell.weekday}:${cell.hour}`)
  );

  const days = HEATMAP_WEEKDAY_ORDER.map((weekday) => {
    const bucket = weekdayMap.get(weekday) || { orders: 0, revenue: 0 };
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday],
      orders: bucket.orders,
      products: bucket.products || 0,
      revenue: roundMoney(bucket.revenue),
    };
  });

  const rows = hours.map((hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    cells: HEATMAP_WEEKDAY_ORDER.map((weekday) => {
      const key = `${weekday}:${hour}`;
      const isOpen = !schedule.hasSchedule || schedule.openKeys.has(key);
      const cell = cellMap.get(key) || { orders: 0, products: 0, revenue: 0 };
      return {
        weekday,
        hour,
        isOpen,
        orders: cell.orders,
        products: cell.products,
        revenue: roundMoney(cell.revenue),
        intensity: isOpen && cell.products ? roundMoney(cell.products / maxProducts) : 0,
        isPeak: isOpen && topKeys.has(key),
      };
    }),
  }));

  const topWindows = [...cellMap.values()]
    .sort(
      (left, right) =>
        right.products - left.products ||
        right.orders - left.orders ||
        right.revenue - left.revenue
    )
    .slice(0, 5)
    .map((cell) => ({
      weekday: cell.weekday,
      weekdayLabel: WEEKDAY_LABELS[cell.weekday],
      hour: cell.hour,
      label: `${WEEKDAY_LABELS[cell.weekday]} ${String(cell.hour).padStart(2, "0")}:00`,
      orders: cell.orders,
      products: cell.products,
      revenue: roundMoney(cell.revenue),
      intensity: roundMoney(cell.products / maxProducts),
    }));

  const bestHoursByWeekday = new Map();
  HEATMAP_WEEKDAY_ORDER.forEach((weekday) => {
    const best = [...cellMap.values()]
      .filter((cell) => cell.weekday === weekday)
      .sort(
        (left, right) =>
          right.products - left.products ||
          right.orders - left.orders ||
          right.revenue - left.revenue
      )
      .slice(0, 2);
    bestHoursByWeekday.set(weekday, best);
  });

  const nextWaves = (calendarIndicators?.upcomingDays || [])
    .slice(0, 14)
    .flatMap((day) =>
      (bestHoursByWeekday.get(day.weekday) || []).map((cell) => ({
        date: day.date,
        dayOfMonth: day.dayOfMonth,
        weekday: day.weekday,
        weekdayLabel: day.weekdayLabel,
        hour: cell.hour,
        label: `${day.weekdayLabel} ${day.dayOfMonth}, ${String(cell.hour).padStart(2, "0")}:00`,
        orders: cell.orders,
        products: cell.products,
        revenue: roundMoney(cell.revenue),
        expectedRevenue: day.expectedRevenue,
        isTopUpcoming: Boolean(day.isTopWeekday || day.isTopMonthday),
      }))
    )
    .sort((left, right) => {
      if (right.isTopUpcoming !== left.isTopUpcoming) return right.isTopUpcoming ? 1 : -1;
      return (
        right.products - left.products ||
        right.orders - left.orders ||
        new Date(left.date) - new Date(right.date)
      );
    })
    .slice(0, 6);

  const nowParts = getLocalDateParts(now);
  const nowHour = getLocalHour(now);

  return {
    sampleOrders,
    sampleProducts,
    days,
    hours,
    rows,
    hasSchedule: schedule.hasSchedule,
    topWindows,
    nextWaves,
    peak: topWindows[0] || null,
    current: nowParts
      ? {
          weekday: nowParts.weekday,
          weekdayLabel: nowParts.weekdayLabel,
          dayOfMonth: nowParts.dayOfMonth,
          hour: nowHour,
        }
      : null,
  };
};

const buildBoostReturnUrl = (req, sale, status) => {
  const origin = String(
    req.body?.frontendOrigin || process.env.FRONT_BASE_URL || process.env.PUBLIC_FRONTEND_URL || ""
  ).replace(/\/$/, "");
  const fallbackPath = `/seguimiento/${sale.code}`;
  const path = String(req.body?.returnPath || fallbackPath);
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    payment: status,
    boost_payment: status,
    order_code: sale.code,
  });
  return `${origin}${path}${separator}${params.toString()}&session_id={CHECKOUT_SESSION_ID}`;
};

const normalizePhone = (value) =>
  String(value || "")
    .replace(/[^\d+]/g, "")
    .trim();

const getLineName = (item) =>
  String(
    item?.name ||
      item?.pizzaName ||
      item?.title ||
      (item?.leftName && item?.rightName ? `${item.leftName} / ${item.rightName}` : "") ||
      (item?.pizzaId ? `Producto #${item.pizzaId}` : "Producto")
  ).trim();

export const formatSale = (sale) => {
  const customerData = asObject(sale.customerData);
  const paymentMode = normalizeSalePaymentMode(sale, customerData);
  const paymentStatus = normalizeSalePaymentStatus(sale, customerData);
  const boostAmount =
    sale.boostAmount == null ? 0 : Number(sale.boostAmount || 0);
  const scheduledFor = getScheduledFor(sale);
  const customerSales = Array.isArray(sale.customer?.sales) ? sale.customer.sales : [];
  const orderCount = Number(sale.customer?._count?.sales || customerSales.length || 0);
  const averageTicket = customerSales.length
    ? customerSales.reduce((sum, row) => sum + Number(row.total || 0), 0) / customerSales.length
    : 0;
  const lastTicket = Number(customerSales[0]?.total || 0);
  const trend =
    !orderCount
      ? "Sin compras"
      : orderCount === 1
      ? "Inicial"
      : lastTicket >= averageTicket * 1.15
      ? "En alza"
      : lastTicket < averageTicket * 0.85
      ? "Bajando"
      : "Estable";

  return {
    id: sale.id,
    code: sale.code,
    date: sale.date,
    createdAt: sale.createdAt,
    type: sale.type,
    delivery: sale.delivery,
    status: sale.status,
    channel: sale.channel,
    currency: sale.currency,
    processed: sale.processed,
    paymentMode,
    paymentStatus,
    scheduledFor,
    isScheduled: Boolean(scheduledFor),
    total: Number(sale.total || 0),
    discounts: Number(sale.discounts || 0),
    boost: {
      active: Boolean(sale.boostActive),
      targetPosition: sale.boostTargetPosition,
      originalPosition: sale.boostOriginalPosition,
      queueCredit: Number(sale.boostQueueCredit || 0),
      amount: Number.isFinite(boostAmount) ? boostAmount : 0,
      paidAt: sale.boostPaidAt,
      meta: asObject(sale.boostMeta),
    },
    notes: sale.notes || "",
    storeId: sale.storeId,
    storeName: sale.store?.storeName || "",
    storeSlug: sale.store?.slug || "",
    partnerId: sale.partnerId,
    partnerName: sale.partner?.name || "",
    customerId: sale.customerId,
    customerData: {
      name: customerData.name || sale.customer?.name || "",
      phone: customerData.phone || sale.customer?.phone || "",
      email: customerData.email || sale.customer?.email || "",
      address_1: customerData.address_1 || sale.address_1 || sale.customer?.address_1 || "",
      portal: customerData.portal || sale.customer?.portal || "",
      observations: customerData.observations || sale.customer?.observations || "",
      code: sale.customer?.code || "",
      segment: normalizeCustomerSegment(sale.customer?.segment, sale.customer?.segment || ""),
      activity: sale.customer?.activity || "",
      daysOff: sale.customer?.daysOff ?? null,
      zipCode: sale.customer?.zipCode || "",
      isRestricted: Boolean(sale.customer?.isRestricted),
      orderCount,
      averageTicket,
      trend,
      paymentMode,
      paymentStatus,
      scheduledFor,
      chatMessages: getChatMessages(customerData),
    },
    products: asArray(sale.products),
    extras: asArray(sale.extras),
  };
};

const buildRepeatCartDraft = (sale) => {
  const formatted = formatSale(sale);
  const items = formatted.products.map((item, index) => ({
    ...item,
    repeatLineId: `${sale.id}-${index}`,
    quantity: getLineQty(item),
  }));

  return {
    source: "repeat_last_order",
    sourceOrderId: sale.id,
    sourceOrderCode: sale.code,
    partnerId: sale.partnerId,
    partnerName: sale.partner?.name || "",
    storeId: sale.storeId,
    storeName: sale.store?.storeName || "",
    storeSlug: sale.store?.slug || "",
    currency: sale.currency || sale.partner?.currency || "EUR",
    customerId: sale.customerId,
    customerData: formatted.customerData,
    items,
    extras: formatted.extras,
    totalProducts: Number(sale.totalProducts || 0),
    discounts: formatted.discounts,
    total: formatted.total,
    editable: true,
    clearable: true,
    createdFromOrderAt: sale.date || sale.createdAt,
  };
};

const findRepeatSales = async (
  prisma,
  { partnerId, storeId, customerId, phone, rawPhone, take = 1 }
) => {
  const matchingCustomerIds = phone
    ? (
        await prisma.customer.findMany({
          where: {
            partnerId,
            OR: [
              { phone: { contains: phone } },
              ...(rawPhone && rawPhone !== phone
                ? [{ phone: { contains: rawPhone } }]
                : []),
            ],
          },
          select: { id: true },
          take: 10,
        })
      ).map((customer) => customer.id)
    : [];

  return prisma.sale.findMany({
    where: {
      partnerId,
      ...(storeId ? { storeId } : {}),
      status: { not: "CANCELED" },
      OR: [
        ...(customerId ? [{ customerId }] : []),
        ...(matchingCustomerIds.length
          ? [{ customerId: { in: matchingCustomerIds } }]
          : []),
        ...(phone
          ? [
              {
                customerData: {
                  path: "$.phone",
                  string_contains: phone,
                },
              },
            ]
          : []),
        ...(rawPhone && rawPhone !== phone
          ? [
              {
                customerData: {
                  path: "$.phone",
                  string_contains: rawPhone,
                },
              },
            ]
          : []),
      ],
    },
    include: {
      partner: { select: { id: true, name: true, currency: true } },
      store: { select: { id: true, storeName: true, slug: true, active: true } },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address_1: true,
          portal: true,
          observations: true,
          code: true,
          segment: true,
          activity: true,
          daysOff: true,
          zipCode: true,
          isRestricted: true,
          _count: { select: { sales: true } },
          sales: {
            select: { total: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: CUSTOMER_RECENT_SALES_TAKE,
          },
        },
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
  });
};

const orderScopeWhere = ({ partnerId, storeId, activeStoresOnly = true }) => ({
  ...(partnerId ? { partnerId } : {}),
  ...(storeId ? { storeId } : {}),
  ...(activeStoresOnly ? { store: { active: true } } : {}),
});

const pendingOrderWhere = ({ partnerId, storeId, activeStoresOnly = true }) => ({
  ...orderScopeWhere({ partnerId, storeId, activeStoresOnly }),
  processed: false,
  status: "PAID",
});

export const completedOrderWhere = ({ partnerId, storeId, activeStoresOnly = true }) => ({
  ...orderScopeWhere({ partnerId, storeId, activeStoresOnly }),
  processed: true,
  status: "PAID",
});

const queueOrderBy = [{ date: "asc" }, { createdAt: "asc" }];

const compareQueueAge = (left, right) => {
  const leftDate = new Date(left.date || left.createdAt || 0).getTime();
  const rightDate = new Date(right.date || right.createdAt || 0).getTime();
  return leftDate - rightDate;
};

const isVipSale = (row) => {
  const customerData = asObject(row.customerData);
  return normalizeCustomerSegment(row.customer?.segment || customerData.segment) === VIP_CUSTOMER_SEGMENT;
};

const compareBoosts = (left, right) => {
  const leftTarget = parsePositiveInt(left.boostTargetPosition) || 1;
  const rightTarget = parsePositiveInt(right.boostTargetPosition) || 1;
  if (leftTarget !== rightTarget) return leftTarget - rightTarget;

  const leftCredit = Number(left.boostQueueCredit || 0);
  const rightCredit = Number(right.boostQueueCredit || 0);
  if (leftCredit !== rightCredit) return rightCredit - leftCredit;

  const leftPaid = left.boostPaidAt ? new Date(left.boostPaidAt).getTime() : 0;
  const rightPaid = right.boostPaidAt ? new Date(right.boostPaidAt).getTime() : 0;
  if (leftPaid !== rightPaid) return leftPaid - rightPaid;

  return compareQueueAge(left, right);
};

const applyPriorityQueueOrder = (rows) => {
  const boosted = rows.filter((row) => row.boostActive).sort(compareBoosts);
  const vip = rows
    .filter((row) => !row.boostActive && isVipSale(row))
    .sort(compareQueueAge);
  const regular = rows
    .filter((row) => !row.boostActive && !isVipSale(row))
    .sort(compareQueueAge);

  return [...boosted, ...vip, ...regular];
};

const clampTargetPosition = (value, currentPosition) => {
  const parsed = parsePositiveInt(value) || 1;
  return Math.min(Math.max(parsed, 1), Math.max(currentPosition, 1));
};

const buildBoostQuote = ({ sale, queue, targetPosition, settings }) => {
  const currentIndex = queue.findIndex((item) => item.id === sale.id);
  const currentPosition = currentIndex >= 0 ? currentIndex + 1 : queue.length + 1;
  const target = clampTargetPosition(targetPosition, currentPosition);
  const positionsToJump = Math.max(currentPosition - target, 0);
  const unitPrice = settings.unitPrice;
  const amount = roundMoney(positionsToJump * unitPrice);
  const voltaAmount = roundMoney(amount * (settings.voltaSharePercent / 100));
  const partnerAmount = roundMoney(amount - voltaAmount);

  return {
    orderId: sale.id,
    code: sale.code,
    storeId: sale.storeId,
    storeName: sale.store?.storeName || "",
    partnerId: sale.partnerId,
    partnerName: sale.partner?.name || "",
    currency: sale.currency || sale.partner?.currency || "EUR",
    currentPosition,
    targetPosition: target,
    positionsToJump,
    unitPrice,
    amount,
    voltaSharePercent: settings.voltaSharePercent,
    partnerSharePercent: settings.partnerSharePercent,
    voltaAmount,
    partnerAmount,
    alreadyBoosted: Boolean(sale.boostActive),
    paidAt: sale.boostPaidAt,
  };
};

const findBoostableSale = async (prisma, { orderId, orderCode }) => {
  const id = parsePositiveInt(orderId);
  const code = String(orderCode || "").trim().toUpperCase();

  if (!id && !code) return null;

  return prisma.sale.findFirst({
    where: {
      ...(id ? { id } : { code }),
      processed: false,
      status: "PAID",
    },
    include: {
      partner: { select: { id: true, name: true, currency: true } },
      store: { select: { id: true, storeName: true, slug: true, active: true } },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address_1: true,
          portal: true,
          observations: true,
          code: true,
          segment: true,
          activity: true,
          daysOff: true,
          zipCode: true,
          isRestricted: true,
          _count: { select: { sales: true } },
          sales: {
            select: { total: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: CUSTOMER_RECENT_SALES_TAKE,
          },
        },
      },
    },
  });
};

const loadStoreQueue = async (prisma, sale) => {
  const rows = await prisma.sale.findMany({
    where: pendingOrderWhere({
      partnerId: sale.partnerId,
      storeId: sale.storeId,
      activeStoresOnly: false,
    }),
    select: {
      id: true,
      code: true,
      date: true,
      createdAt: true,
      boostActive: true,
      boostTargetPosition: true,
      boostQueueCredit: true,
      boostPaidAt: true,
      customerData: true,
      customer: { select: { segment: true } },
    },
    orderBy: queueOrderBy,
  });

  return applyPriorityQueueOrder(rows);
};

export default function myordersRoutes(prisma) {
  const router = express.Router();

  router.get("/repeat/recent", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const customerId = parsePositiveInt(req.query.customerId);
    const rawPhone = String(req.query.phone || "").trim();
    const phone = normalizePhone(req.query.phone);

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId requerido" });
    }

    if (!customerId && !phone) {
      return res.status(400).json({ error: "Telefono o customerId requerido" });
    }

    try {
      const sales = await findRepeatSales(prisma, {
        partnerId,
        storeId,
        customerId,
        phone,
        rawPhone,
        take: 3,
      });

      return res.json({
        ok: true,
        orders: sales.map((sale) => ({
          order: formatSale(sale),
          cartDraft: buildRepeatCartDraft(sale),
        })),
      });
    } catch (error) {
      console.error("[myorders.repeat.recent] error:", error);
      return res.status(500).json({ error: "Error buscando pedidos anteriores" });
    }
  });

  router.get("/repeat/latest", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const customerId = parsePositiveInt(req.query.customerId);
    const rawPhone = String(req.query.phone || "").trim();
    const phone = normalizePhone(req.query.phone);

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId requerido" });
    }

    if (!customerId && !phone) {
      return res.status(400).json({ error: "Telefono o customerId requerido" });
    }

    try {
      const [sale] = await findRepeatSales(prisma, {
        partnerId,
        storeId,
        customerId,
        phone,
        rawPhone,
        take: 1,
      });

      if (!sale) {
        return res.status(404).json({ error: "No encontramos un pedido anterior para repetir" });
      }

      return res.json({
        ok: true,
        order: formatSale(sale),
        cartDraft: buildRepeatCartDraft(sale),
      });
    } catch (error) {
      console.error("[myorders.repeat.latest] error:", error);
      return res.status(500).json({ error: "Error buscando el ultimo pedido" });
    }
  });

  router.get("/boosts/quote", async (req, res) => {
    try {
      const sale = await findBoostableSale(prisma, {
        orderId: req.query.orderId,
        orderCode: req.query.orderCode || req.query.code,
      });

      if (!sale) {
        return res.status(404).json({ error: "Pedido pendiente no encontrado" });
      }

      const queue = await loadStoreQueue(prisma, sale);
      const settings = await getBoostSettings(prisma);
      if (!settings.active) {
        return res.status(409).json({ error: "Boost no esta activo ahora mismo" });
      }

      const quote = buildBoostQuote({
        sale,
        queue,
        targetPosition: req.query.targetPosition,
        settings,
      });

      return res.json({ ok: true, quote });
    } catch (error) {
      console.error("[myorders.boosts.quote] error:", error);
      return res.status(500).json({ error: "Error cotizando Boots" });
    }
  });

  router.post("/boosts/activate", async (req, res) => {
    try {
      const sale = await findBoostableSale(prisma, {
        orderId: req.body?.orderId,
        orderCode: req.body?.orderCode || req.body?.code,
      });

      if (!sale) {
        return res.status(404).json({ error: "Pedido pendiente no encontrado" });
      }

      const queue = await loadStoreQueue(prisma, sale);
      const settings = await getBoostSettings(prisma);
      if (!settings.active) {
        return res.status(409).json({ error: "Boost no esta activo ahora mismo" });
      }

      const quote = buildBoostQuote({
        sale,
        queue,
        targetPosition: req.body?.targetPosition,
        settings,
      });

      if (quote.positionsToJump <= 0) {
        return res.status(409).json({
          error: "Este pedido ya esta en la mejor posicion disponible",
          quote,
        });
      }

      if (!isStripeCheckoutConfigured()) {
        return res.status(503).json({ error: "stripe_not_configured", quote });
      }

      const amountCents = toCents(quote.amount);
      if (amountCents < 50) {
        return res.status(400).json({ error: "boost_amount_too_low", quote });
      }

      const session = await createBoostCheckoutSession({
        sale,
        quote,
        amountCents,
        currency: quote.currency,
        successUrl: buildBoostReturnUrl(req, sale, "success"),
        cancelUrl: buildBoostReturnUrl(req, sale, "cancel"),
      });

      if (!session?.url) {
        return res.status(502).json({ error: "stripe_session_url_missing", quote });
      }

      return res.json({
        ok: true,
        quote,
        sessionId: session.id,
        url: session.url,
      });
    } catch (error) {
      console.error("[myorders.boosts.activate] error:", error);
      return res.status(500).json({ error: "Error activando Boots" });
    }
  });

  router.get("/pending", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const take = Math.min(parsePositiveInt(req.query.take) || 80, 200);
    const cacheKey = req.originalUrl;
    const cachedPayload = pendingOrdersCache.get(cacheKey);

    if (cachedPayload) {
      res.set("X-Volta-Cache", "HIT myorders-pending");
      return res.json(cachedPayload);
    }

    try {
      const where = pendingOrderWhere({ partnerId, storeId, activeStoresOnly: false });

      const [rows, queueSize] = await Promise.all([
        prisma.sale.findMany({
          where,
          include: {
            partner: { select: { id: true, name: true, currency: true } },
            store: { select: { id: true, storeName: true, slug: true, active: true } },
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                address_1: true,
                portal: true,
                observations: true,
                code: true,
                segment: true,
                activity: true,
                daysOff: true,
                zipCode: true,
                isRestricted: true,
                _count: { select: { sales: true } },
                sales: {
                  select: { total: true, createdAt: true },
                  orderBy: { createdAt: "desc" },
                  take: CUSTOMER_RECENT_SALES_TAKE,
                },
              },
            },
          },
          orderBy: queueOrderBy,
          take: 200,
        }),
        prisma.sale.count({ where }),
      ]);

      const orderedRows = applyPriorityQueueOrder(rows).slice(0, take);

      const payload = {
        items: orderedRows.map((row, index) => ({
          ...formatSale(row),
          queuePosition: index + 1,
        })),
        queueSize,
        updatedAt: new Date().toISOString(),
      };

      pendingOrdersCache.set(cacheKey, payload);
      res.set("X-Volta-Cache", "MISS myorders-pending");
      return res.json(payload);
    } catch (error) {
      console.error("[myorders.pending] error:", error);
      return res.status(500).json({ error: "Error loading pending orders" });
    }
  });

  router.get("/summary", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const period = String(req.query.period || "today").toLowerCase() === "week" ? "week" : "today";
    const { from, to, label } = getPeriodRange(period);
    const historyFrom = subtractDays(nowInTZ(), SUMMARY_HISTORY_DAYS);
    const scope = orderScopeWhere({ partnerId, storeId, activeStoresOnly: false });
    const cacheKey = req.originalUrl;
    const cachedPayload = summaryCache.get(cacheKey);

    if (cachedPayload) {
      res.set("X-Volta-Cache", "HIT myorders-summary");
      return res.json(cachedPayload);
    }

    try {
      const [
        sales,
        historicalSales,
        pendingCount,
        newCustomers,
        activeStores,
        availableStores,
        stores,
      ] = await Promise.all([
        prisma.sale.findMany({
          where: {
            ...scope,
            ...completedOrderWhere({ partnerId, storeId, activeStoresOnly: false }),
            date: { gte: from, lt: to },
          },
          include: {
            store: { select: { id: true, storeName: true, slug: true } },
            partner: { select: { id: true, name: true, currency: true } },
            customer: { select: { id: true } },
          },
          orderBy: { date: "desc" },
        }),
        prisma.sale.findMany({
          where: {
            ...scope,
            ...completedOrderWhere({ partnerId, storeId, activeStoresOnly: false }),
            date: { gte: historyFrom },
          },
          select: {
            id: true,
            storeId: true,
            date: true,
            createdAt: true,
            total: true,
            products: true,
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: SUMMARY_HISTORY_MAX_ROWS,
        }),
        prisma.sale.count({
          where: pendingOrderWhere({ partnerId, storeId, activeStoresOnly: false }),
        }),
        prisma.customer.count({
          where: {
            ...(partnerId ? { partnerId } : {}),
            createdAt: { gte: from, lt: to },
          },
        }),
        prisma.store.count({
          where: {
            active: true,
            ...(partnerId ? { partnerId } : {}),
            ...(storeId ? { id: storeId } : {}),
          },
        }),
        prisma.store.findMany({
          where: {
            ...(partnerId ? { partnerId } : {}),
          },
          select: {
            id: true,
            storeName: true,
            slug: true,
            partnerId: true,
            partner: { select: { name: true, currency: true } },
            hours: {
              select: { storeId: true, dayOfWeek: true, openTime: true, closeTime: true },
              orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
            },
          },
          orderBy: [{ partnerId: "asc" }, { storeName: "asc" }],
        }),
        prisma.store.findMany({
          where: {
            ...(partnerId ? { partnerId } : {}),
            ...(storeId ? { id: storeId } : {}),
          },
          select: {
            id: true,
            storeName: true,
            slug: true,
            partnerId: true,
            partner: { select: { name: true, currency: true } },
          },
          orderBy: [{ partnerId: "asc" }, { storeName: "asc" }],
        }),
      ]);

      const safeSales = sales.filter((sale) => Number.isFinite(Number(sale.total)));
      const revenue = safeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
      const ordersCount = safeSales.length;
      const averageTicket = ordersCount ? revenue / ordersCount : 0;
      const deliveryOrders = safeSales.filter((sale) => String(sale.delivery || sale.type || "").toUpperCase().includes("COURIER") || String(sale.type || "").toUpperCase().includes("DELIVERY")).length;
      const pickupOrders = Math.max(ordersCount - deliveryOrders, 0);
      const uniqueCustomers = new Set(safeSales.map((sale) => sale.customerId).filter(Boolean)).size;

      const storeMap = new Map();
      stores.forEach((store) => {
        storeMap.set(store.id, {
          storeId: store.id,
          storeName: store.storeName,
          partnerId: store.partnerId,
          partnerName: store.partner?.name || "",
          currency: store.partner?.currency || "EUR",
          pending: 0,
          orders: 0,
          revenue: 0,
        });
      });

      safeSales.forEach((sale) => {
        if (!storeMap.has(sale.storeId)) {
          storeMap.set(sale.storeId, {
            storeId: sale.storeId,
            storeName: sale.store?.storeName || "Tienda",
            partnerId: sale.partnerId,
            partnerName: sale.partner?.name || "",
            currency: sale.partner?.currency || "EUR",
            pending: 0,
            orders: 0,
            revenue: 0,
          });
        }

        const row = storeMap.get(sale.storeId);
        row.orders += 1;
        row.revenue += Number(sale.total || 0);
      });

      const pendingRows = await prisma.sale.groupBy({
        by: ["storeId"],
        where: pendingOrderWhere({ partnerId, storeId, activeStoresOnly: false }),
        _count: { _all: true },
      });

      pendingRows.forEach((row) => {
        if (!storeMap.has(row.storeId)) return;
        storeMap.get(row.storeId).pending = row._count?._all || 0;
      });

      const productMap = new Map();
      safeSales.forEach((sale) => {
        asArray(sale.products).forEach((item) => {
          const name = getLineName(item);
          const qty = getLineQty(item);
          const current = productMap.get(name) || { name, qty: 0, revenue: 0 };
          current.qty += qty;
          current.revenue += Number(item?.total || item?.lineTotal || item?.price || item?.unitPrice || 0) * qty;
          productMap.set(name, current);
        });
      });

      const topProducts = [...productMap.values()]
        .sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name))
        .slice(0, 6);
      const storeHours = stores.flatMap((store) => store.hours || []);
      const calendarIndicators = buildCalendarIndicators(historicalSales);
      const trafficHeatmap = buildTrafficHeatmap(historicalSales, calendarIndicators, storeHours);

      const payload = {
        period,
        periodLabel: label,
        from,
        to,
        currency:
          safeSales[0]?.partner?.currency ||
          stores[0]?.partner?.currency ||
          availableStores[0]?.partner?.currency ||
          "EUR",
        kpis: {
          revenue,
          ordersCount,
          pendingCount,
          averageTicket,
          newCustomers,
          uniqueCustomers,
          activeStores,
          deliveryOrders,
          pickupOrders,
        },
        calendarIndicators,
        trafficHeatmap,
        analyticsWindow: {
          from: historyFrom,
          days: SUMMARY_HISTORY_DAYS,
          maxRows: SUMMARY_HISTORY_MAX_ROWS,
          sampleOrders: historicalSales.length,
        },
        availableStores: availableStores.map((store) => ({
          storeId: store.id,
          storeName: store.storeName,
          partnerId: store.partnerId,
          partnerName: store.partner?.name || "",
          currency: store.partner?.currency || "EUR",
        })),
        stores: [...storeMap.values()].sort((left, right) => {
          if (right.pending !== left.pending) return right.pending - left.pending;
          if (right.revenue !== left.revenue) return right.revenue - left.revenue;
          return left.storeName.localeCompare(right.storeName);
        }),
        topProducts,
        orders: safeSales.map(formatSale),
        updatedAt: new Date().toISOString(),
      };

      summaryCache.set(cacheKey, payload);
      res.set("X-Volta-Cache", "MISS myorders-summary");
      return res.json(payload);
    } catch (error) {
      console.error("[myorders.summary] error:", error);
      return res.status(500).json({ error: "Error building MyOrders summary" });
    }
  });

  router.patch("/:id/ready", async (req, res) => {
    const id = parsePositiveInt(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Valid order id required" });
    }

    try {
      const sale = await prisma.sale.findFirst({
        where: {
          id,
          status: "PAID",
        },
        select: { id: true, status: true, processed: true, customerData: true },
      });

      if (!sale) {
        return res.status(404).json({ error: "Order not found or payment not confirmed" });
      }

      if (sale.processed) {
        return res.status(409).json({ error: "Order already completed" });
      }

      const scheduledFor = getScheduledFor(sale);
      if (scheduledFor && new Date(scheduledFor).getTime() > Date.now()) {
        return res.status(409).json({
          error: "espera el momento Ã°Å¸Â§ËœÃ¢â‚¬ÂÃ¢â„¢â€šÃ¯Â¸Â",
          code: "SCHEDULED_ORDER_LOCKED",
          scheduledFor,
          serverTime: new Date().toISOString(),
        });
      }

      const updated = await prisma.sale.update({
        where: { id },
        data: { processed: true },
        include: {
          partner: { select: { id: true, name: true, currency: true } },
          store: { select: { id: true, storeName: true, slug: true, active: true } },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              address_1: true,
              portal: true,
              observations: true,
              code: true,
              segment: true,
              activity: true,
              daysOff: true,
              zipCode: true,
              isRestricted: true,
              _count: { select: { sales: true } },
              sales: {
                select: { total: true, createdAt: true },
                orderBy: { createdAt: "desc" },
                take: CUSTOMER_RECENT_SALES_TAKE,
              },
            },
          },
        },
      });

      const notification = sale.processed
        ? { ok: false, skipped: true, reason: "already_processed" }
        : await sendOrderReadySms(prisma, updated).catch((error) => {
            console.error("[myorders.ready-sms] error:", error);
            return { ok: false, skipped: true, reason: "ready_sms_error" };
          });

      if (!notification.ok) console.warn("[myorders.ready-sms]", notification);
      const reviewRequest = sale.processed
        ? { ok: false, skipped: true, reason: "already_processed" }
        : await createProductReviewRequestForSale(prisma, updated).catch((error) => {
            console.error("[myorders.review-request] error:", error);
            return { ok: false, skipped: true, reason: "review_request_error" };
          });

      return res.json({ ok: true, order: formatSale(updated), notification, reviewRequest });
    } catch (error) {
      console.error("[myorders.ready] error:", error);
      return res.status(500).json({ error: "Error marking order ready" });
    }
  });

  router.get("/:id/messages", async (req, res) => {
    const id = parsePositiveInt(req.params.id);

    if (!id) {
      return res.status(400).json({ ok: false, error: "valid_order_id_required" });
    }

    try {
      const sale = await prisma.sale.findFirst({
        where: { id, status: { not: "CANCELED" } },
        select: { id: true, code: true, customerData: true },
      });

      if (!sale) {
        return res.status(404).json({ ok: false, error: "order_not_found" });
      }

      return res.json({
        ok: true,
        orderId: sale.id,
        orderCode: sale.code,
        messages: getChatMessages(sale.customerData),
      });
    } catch (error) {
      console.error("[myorders.messages] error:", error);
      return res.status(500).json({ ok: false, error: "messages_failed" });
    }
  });

  router.patch("/:id/messages/read", async (req, res) => {
    const id = parsePositiveInt(req.params.id);

    if (!id) {
      return res.status(400).json({ ok: false, error: "valid_order_id_required" });
    }

    try {
      const sale = await prisma.sale.findFirst({
        where: { id, status: { not: "CANCELED" } },
        select: { id: true, code: true, customerData: true },
      });

      if (!sale) {
        return res.status(404).json({ ok: false, error: "order_not_found" });
      }

      const customerData = markCustomerChatMessagesRead(sale.customerData);
      await prisma.sale.update({
        where: { id: sale.id },
        data: { customerData },
      });

      return res.json({
        ok: true,
        orderId: sale.id,
        orderCode: sale.code,
        messages: getChatMessages(customerData),
      });
    } catch (error) {
      console.error("[myorders.messages.read] error:", error);
      return res.status(500).json({ ok: false, error: "messages_read_failed" });
    }
  });

  router.post("/:id/messages", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const text = cleanChatText(req.body?.text).slice(0, 70);

    if (!id) {
      return res.status(400).json({ ok: false, error: "valid_order_id_required" });
    }

    if (text.length < 2) {
      return res.status(400).json({ ok: false, error: "bad_message" });
    }

    try {
      const sale = await prisma.sale.findFirst({
        where: { id, status: { not: "CANCELED" } },
        include: {
          store: { select: { id: true, storeName: true, slug: true } },
          customer: { select: { id: true, name: true, phone: true } },
        },
      });

      if (!sale) {
        return res.status(404).json({ ok: false, error: "order_not_found" });
      }

      const message = {
        id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sender: "OPERATOR",
        text,
        createdAt: new Date().toISOString(),
        readAt: null,
      };

      const customerData = appendChatMessage(sale.customerData, message);
      await prisma.sale.update({
        where: { id: sale.id },
        data: { customerData },
      });

      const notification = await sendOrderCustomerMessageSms(prisma, {
        ...sale,
        customerData,
      }, text).catch((error) => {
        console.error("[myorders.chat-sms] error:", error);
        return { ok: false, skipped: true, reason: "chat_sms_error" };
      });

      return res.json({
        ok: true,
        message,
        messages: getChatMessages(customerData),
        notification,
      });
    } catch (error) {
      console.error("[myorders.messages.send] error:", error);
      return res.status(500).json({ ok: false, error: "message_send_failed" });
    }
  });

  return router;
}
