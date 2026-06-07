import { reserveSmsCreditForMessage, refundSmsCreditForMessage } from "./smsCredits.js";
import { estimateSmsParts, normalizeE164Phone, sendTelnyxSms } from "./telnyx.js";
import {
  getSmsNotificationRecipients,
  isSmsNotificationServiceEnabled,
  normalizeSmsNotificationSettings,
} from "./smsNotificationSettings.js";

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
  const parsed = parseMaybeJson(parseMaybeJson(value, {}), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

export const normalizeTrackingNotificationSettings = normalizeSmsNotificationSettings;

const cleanSmsPart = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const shortSmsPart = (value, max = 28) => cleanSmsPart(value).slice(0, max);

const trackingTimeZone = () => process.env.TIMEZONE || "Europe/Madrid";

const formatTimestampES = (value) => {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return new Intl.DateTimeFormat("es-ES", {
    timeZone: trackingTimeZone(),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(safeDate)
    .replace(",", "");
};

const withTimestamp = (text, occurredAt) =>
  `${cleanSmsPart(text)} Momento: ${formatTimestampES(occurredAt)}.`;

const smsBrand = (partnerName) => cleanSmsPart(partnerName || process.env.TELNYX_SMS_BRAND || "VoltaPizza");

const buildIngredientDisabledText = ({ partnerName, storeName, ingredientName, occurredAt }) => {
  const brand = smsBrand(partnerName);
  const ingredient = shortSmsPart(ingredientName || "Ingrediente");
  const store = shortSmsPart(storeName || "tienda");
  return withTimestamp(`${brand}: ingrediente off. ${ingredient} en ${store}.`, occurredAt);
};

const buildStoreStatusText = ({ partnerName, storeName, active, occurredAt }) => {
  const brand = smsBrand(partnerName);
  const store = shortSmsPart(storeName || "tienda");
  return withTimestamp(`${brand}: tienda ${active ? "abierta" : "cerrada"}: ${store}.`, occurredAt);
};

const formatDateES = (date) => {
  const value = date ? new Date(date) : null;
  if (!value || Number.isNaN(value.getTime())) return "";

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
};

const buildReservationCanceledText = ({ partnerName, storeName, customerName, reservationDate, reservationTime, partySize, occurredAt }) => {
  const brand = smsBrand(partnerName);
  const customer = shortSmsPart(customerName || "Cliente", 24);
  const store = shortSmsPart(storeName || "tienda", 24);
  const date = formatDateES(reservationDate);
  const time = cleanSmsPart(reservationTime);
  const people = Number(partySize || 0);
  const details = [date, time, people > 0 ? `${people} pers.` : ""].filter(Boolean).join(" ");
  return withTimestamp(`${brand}: reserva cancelada ${store}: ${customer}${details ? ` (${details})` : ""}.`, occurredAt);
};

const getSaleCustomerName = (sale) => {
  const customerData = asObject(sale?.customerData);
  return cleanSmsPart(customerData.name || sale?.customer?.name || "Cliente");
};

const buildBoostPurchasedText = ({ partnerName, storeName, sale, occurredAt }) => {
  const brand = smsBrand(partnerName);
  const store = shortSmsPart(storeName || "tienda", 24);
  const code = cleanSmsPart(sale?.code || "pedido");
  const amount = Number(sale?.boostAmount || 0);
  const currency = cleanSmsPart(sale?.currency || "EUR");
  const target = Number(sale?.boostTargetPosition || 0);
  const queueCredit = Number(sale?.boostQueueCredit || 0);
  const amountText = amount > 0 ? ` por ${amount.toFixed(2)} ${currency}` : "";
  const positionText = target > 0 ? ` prioridad #${target}` : "";
  const jumpText = queueCredit > 0 ? `, salto ${queueCredit}` : "";
  return withTimestamp(`${brand}: Boost ${code} en ${store}${amountText}${positionText}${jumpText}.`, occurredAt);
};

const sendPartnerTrackingSms = async (
  prisma,
  {
    partner,
    partnerId,
    serviceId,
    reference,
    text,
    tags,
    meta,
    storeId,
  },
  deps = {}
) => {
  const settings = normalizeTrackingNotificationSettings(partner?.trackingNotificationSettings);
  if (!isSmsNotificationServiceEnabled(settings, serviceId, { storeId })) {
    return { ok: false, skipped: true, reason: "tracking_disabled" };
  }

  const recipients = getSmsNotificationRecipients(settings)
    .map(normalizeE164Phone)
    .filter(Boolean);

  if (!settings.contactPhoneConfirmed) {
    return { ok: false, skipped: true, reason: "phone_not_confirmed" };
  }

  if (!recipients.length) {
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const reserve = deps.reserveSmsCreditForMessage || reserveSmsCreditForMessage;
  const refund = deps.refundSmsCreditForMessage || refundSmsCreditForMessage;
  const sendSms = deps.sendTelnyxSms || sendTelnyxSms;
  const smsEstimate = estimateSmsParts(text);

  const results = [];

  for (const [index, to] of recipients.entries()) {
    const recipientReference = recipients.length > 1 ? `${reference}:phone-${index + 1}` : reference;
    const reservation = await reserve(prisma, {
      partnerId,
      reference: recipientReference,
      to,
      quantity: smsEstimate.parts,
      meta: {
        ...(meta && typeof meta === "object" ? meta : {}),
        smsEstimate,
        recipientIndex: index + 1,
        recipientCount: recipients.length,
      },
    });

    if (!reservation.ok) {
      results.push({ ok: false, skipped: true, reason: reservation.error, reference: recipientReference, to });
      continue;
    }

    const result = await sendSms({
      to,
      text,
      tags,
    });

    if (!result.ok) {
      await refund(prisma, {
        partnerId,
        reference: recipientReference,
        reason: result.error?.title || "tracking_sms_failed",
        quantity: smsEstimate.parts,
        meta: {
          ...(meta && typeof meta === "object" ? meta : {}),
          smsEstimate,
          recipientIndex: index + 1,
          recipientCount: recipients.length,
        },
      }).catch((error) => {
        console.error(`[tracking-notifications.${serviceId}] refund error:`, error);
      });
    }

    results.push({
      ...result,
      reference: recipientReference,
      ledgerId: reservation.ledgerId,
      to,
    });
  }

  const firstSent = results.find((result) => result.ok) || results[0];
  return {
    ...firstSent,
    reference,
    results,
    sentCount: results.filter((result) => result.ok).length,
  };
};

export async function sendIngredientDisabledTrackingSms(
  prisma,
  { store, ingredient, stock } = {},
  deps = {}
) {
  const partner = store?.partner || null;
  const partnerId = Number(store?.partnerId || partner?.id || 0);
  const storeId = Number(store?.id || stock?.storeId || 0);
  const ingredientId = Number(ingredient?.id || stock?.ingredientId || 0);

  if (!partnerId || !storeId || !ingredientId) {
    return { ok: false, skipped: true, reason: "missing_context" };
  }

  const reference = `ingredient-disabled:${storeId}:${ingredientId}`;
  const occurredAt = stock?.updatedAt || stock?.createdAt || new Date();
  const meta = {
    serviceId: "ingredientDisabled",
    storeId,
    ingredientId,
    storeName: store?.storeName || "",
    ingredientName: ingredient?.name || "",
    occurredAt,
  };

  return sendPartnerTrackingSms(
    prisma,
    {
      partner,
      partnerId,
      serviceId: "ingredientDisabled",
      reference,
      meta,
      storeId,
      text: buildIngredientDisabledText({
        partnerName: partner?.name,
        storeName: store?.storeName,
        ingredientName: ingredient?.name,
        occurredAt,
      }),
      tags: [
        "tracking:ingredientDisabled",
        `partner:${partnerId}`,
        `store:${storeId}`,
        `ingredient:${ingredientId}`,
      ],
    },
    deps
  );
}

export async function sendStoreStatusTrackingSms(
  prisma,
  { store } = {},
  deps = {}
) {
  const partner = store?.partner || null;
  const partnerId = Number(store?.partnerId || partner?.id || 0);
  const storeId = Number(store?.id || 0);

  if (!partnerId || !storeId) {
    return { ok: false, skipped: true, reason: "missing_context" };
  }

  const isActive = Boolean(store?.active);
  const reference = `store-status:${storeId}:${isActive ? "open" : "closed"}`;
  const occurredAt = store?.updatedAt || store?.createdAt || new Date();
  const meta = {
    serviceId: "storeOpenClosed",
    storeId,
    storeName: store?.storeName || "",
    active: isActive,
    occurredAt,
  };

  return sendPartnerTrackingSms(
    prisma,
    {
      partner,
      partnerId,
      serviceId: "storeOpenClosed",
      reference,
      meta,
      storeId,
      text: buildStoreStatusText({
        partnerName: partner?.name,
        storeName: store?.storeName,
        active: isActive,
        occurredAt,
      }),
      tags: [
        "tracking:storeOpenClosed",
        `partner:${partnerId}`,
        `store:${storeId}`,
      ],
    },
    deps
  );
}

export async function sendReservationCanceledTrackingSms(
  prisma,
  { reservation } = {},
  deps = {}
) {
  const store = reservation?.store || null;
  const partner = store?.partner || null;
  const partnerId = Number(reservation?.partnerId || store?.partnerId || partner?.id || 0);
  const storeId = Number(reservation?.storeId || store?.id || 0);
  const reservationId = Number(reservation?.id || 0);

  if (!partnerId || !storeId || !reservationId) {
    return { ok: false, skipped: true, reason: "missing_context" };
  }

  const reference = `reservation-canceled:${reservationId}`;
  const occurredAt = reservation?.updatedAt || reservation?.createdAt || new Date();
  const meta = {
    serviceId: "reservationCanceled",
    reservationId,
    storeId,
    storeName: store?.storeName || "",
    customerName: reservation?.customerName || "",
    reservationDate: reservation?.reservationDate || null,
    reservationTime: reservation?.reservationTime || "",
    partySize: reservation?.partySize || null,
    occurredAt,
  };

  return sendPartnerTrackingSms(
    prisma,
    {
      partner,
      partnerId,
      serviceId: "reservationCanceled",
      reference,
      meta,
      storeId,
      text: buildReservationCanceledText({
        partnerName: partner?.name,
        storeName: store?.storeName,
        customerName: reservation?.customerName,
        reservationDate: reservation?.reservationDate,
        reservationTime: reservation?.reservationTime,
        partySize: reservation?.partySize,
        occurredAt,
      }),
      tags: [
        "tracking:reservationCanceled",
        `partner:${partnerId}`,
        `store:${storeId}`,
        `reservation:${reservationId}`,
      ],
    },
    deps
  );
}

export async function sendBoostPurchasedTrackingSms(
  prisma,
  { sale } = {},
  deps = {}
) {
  const store = sale?.store || null;
  const partner = store?.partner || sale?.partner || null;
  const partnerId = Number(sale?.partnerId || store?.partnerId || partner?.id || 0);
  const storeId = Number(sale?.storeId || store?.id || 0);
  const saleId = Number(sale?.id || 0);

  if (!partnerId || !storeId || !saleId) {
    return { ok: false, skipped: true, reason: "missing_context" };
  }

  const reference = `boost-purchased:${saleId}`;
  const occurredAt = sale?.boostPaidAt || sale?.updatedAt || sale?.createdAt || new Date();
  const meta = {
    serviceId: "boostPurchased",
    saleId,
    orderCode: sale?.code || "",
    storeId,
    storeName: store?.storeName || "",
    customerName: getSaleCustomerName(sale),
    boostAmount: Number(sale?.boostAmount || 0),
    boostTargetPosition: sale?.boostTargetPosition || null,
    boostQueueCredit: Number(sale?.boostQueueCredit || 0),
    occurredAt,
  };

  return sendPartnerTrackingSms(
    prisma,
    {
      partner,
      partnerId,
      serviceId: "boostPurchased",
      reference,
      meta,
      storeId,
      text: buildBoostPurchasedText({
        partnerName: partner?.name,
        storeName: store?.storeName,
        sale,
        occurredAt,
      }),
      tags: [
        "tracking:boostPurchased",
        `partner:${partnerId}`,
        `store:${storeId}`,
        `sale:${saleId}`,
      ],
    },
    deps
  );
}
