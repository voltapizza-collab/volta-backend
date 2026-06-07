import { reserveSmsCreditForMessage, refundSmsCreditForMessage } from "./smsCredits.js";
import { isPartnerSmsServiceEnabled } from "./smsNotificationSettings.js";
import { estimateSmsParts, normalizeE164Phone, sendTelnyxSms } from "./telnyx.js";

const frontendBaseUrl = () =>
  String(
    process.env.PUBLIC_FRONTEND_URL ||
      process.env.FRONTEND_URL ||
      process.env.STOREFRONT_URL ||
      process.env.APP_URL ||
      "https://voltapizza.com"
  )
    .trim()
    .replace(/\/$/, "");

export const buildOrderTrackingUrl = (sale) =>
  `${frontendBaseUrl()}/seguimiento/${encodeURIComponent(sale.code)}`;

const readCustomerData = (sale) => {
  const data = sale?.customerData;
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
};

const customerFirstName = (sale) => {
  const data = readCustomerData(sale);
  const raw = data.name || sale?.customer?.name || "tu pedido";
  return String(raw).trim().split(/\s+/)[0] || "tu pedido";
};

const cleanSmsPart = (value) => String(value || "").replace(/\s+/g, " ").trim();

const resolvePartnerName = async (prisma, sale) => {
  const inlineName = cleanSmsPart(sale?.partner?.name || sale?.store?.partner?.name);
  if (inlineName) return inlineName;

  const partnerId = Number(sale?.partnerId || sale?.store?.partnerId || 0);
  if (!partnerId) return cleanSmsPart(process.env.TELNYX_SMS_BRAND || "VoltaPizza");

  try {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { name: true },
    });
    return cleanSmsPart(partner?.name || process.env.TELNYX_SMS_BRAND || "VoltaPizza");
  } catch {
    return cleanSmsPart(process.env.TELNYX_SMS_BRAND || "VoltaPizza");
  }
};

export async function sendOrderPaidTrackingSms(prisma, sale) {
  const serviceEnabled = await isPartnerSmsServiceEnabled(prisma, {
    partnerId: sale.partnerId,
    storeId: sale.storeId,
    serviceId: "customerPaymentSuccess",
  });
  if (!serviceEnabled) {
    return { ok: false, skipped: true, reason: "sms_service_disabled" };
  }

  const data = readCustomerData(sale);
  const to = normalizeE164Phone(data.phone || sale?.customer?.phone);
  if (!to) {
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const trackingUrl = buildOrderTrackingUrl(sale);
  const partnerName = await resolvePartnerName(prisma, sale);
  const text = `${partnerName}: pago OK ${customerFirstName(sale)}. Pedido ${sale.code}. Seguimiento: ${trackingUrl}`;
  const smsEstimate = estimateSmsParts(text);

  const reservation = await reserveSmsCreditForMessage(prisma, {
    partnerId: sale.partnerId,
    couponCode: sale.code,
    customerId: sale.customerId,
    to,
    quantity: smsEstimate.parts,
    meta: { smsEstimate },
  });

  if (!reservation.ok) {
    return { ok: false, skipped: true, reason: reservation.error, trackingUrl };
  }

  const result = await sendTelnyxSms({
    to,
    text,
    tags: [`order:${sale.id}`, `order-code:${sale.code}`, `partner:${sale.partnerId}`],
  });

  if (!result.ok) {
    await refundSmsCreditForMessage(prisma, {
      partnerId: sale.partnerId,
      couponCode: sale.code,
      customerId: sale.customerId,
      reason: result.error?.title || "order_tracking_sms_failed",
      quantity: smsEstimate.parts,
      meta: { smsEstimate },
    }).catch((error) => {
      console.error("[order-notifications.sms] refund error:", error);
    });
  }

  return {
    ...result,
    trackingUrl,
    ledgerId: reservation.ledgerId,
  };
}

export async function sendOrderReadySms(prisma, sale) {
  const serviceEnabled = await isPartnerSmsServiceEnabled(prisma, {
    partnerId: sale.partnerId,
    storeId: sale.storeId,
    serviceId: "customerOrderReady",
  });
  if (!serviceEnabled) {
    return { ok: false, skipped: true, reason: "sms_service_disabled" };
  }

  const data = readCustomerData(sale);
  const to = normalizeE164Phone(data.phone || sale?.customer?.phone);
  if (!to) {
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const storeName = sale?.store?.storeName || "la tienda";
  const partnerName = await resolvePartnerName(prisma, sale);
  const isDelivery = sale.delivery === "COURIER";
  const text = isDelivery
    ? `${partnerName}: pedido ${sale.code} en camino desde ${storeName}.`
    : `${partnerName}: pedido ${sale.code} listo para recoger en ${storeName}.`;
  const smsEstimate = estimateSmsParts(text);

  const reservation = await reserveSmsCreditForMessage(prisma, {
    partnerId: sale.partnerId,
    couponCode: sale.code,
    customerId: sale.customerId,
    to,
    quantity: smsEstimate.parts,
    meta: { smsEstimate },
  });

  if (!reservation.ok) {
    return { ok: false, skipped: true, reason: reservation.error };
  }

  const result = await sendTelnyxSms({
    to,
    text,
    tags: [`order:${sale.id}`, `order-ready:${sale.code}`, `partner:${sale.partnerId}`],
  });

  if (!result.ok) {
    await refundSmsCreditForMessage(prisma, {
      partnerId: sale.partnerId,
      couponCode: sale.code,
      customerId: sale.customerId,
      reason: result.error?.title || "order_ready_sms_failed",
      quantity: smsEstimate.parts,
      meta: { smsEstimate },
    }).catch((error) => {
      console.error("[order-notifications.ready-sms] refund error:", error);
    });
  }

  return {
    ...result,
    ledgerId: reservation.ledgerId,
  };
}

export async function sendOrderCustomerMessageSms(prisma, sale, message) {
  const serviceEnabled = await isPartnerSmsServiceEnabled(prisma, {
    partnerId: sale.partnerId,
    storeId: sale.storeId,
    serviceId: "customerOrderChatMessage",
  });
  if (!serviceEnabled) {
    return { ok: false, skipped: true, reason: "sms_service_disabled" };
  }

  const data = readCustomerData(sale);
  const to = normalizeE164Phone(data.phone || sale?.customer?.phone);
  if (!to) {
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const cleanMessage = String(message || "").trim().replace(/\s+/g, " ").slice(0, 70);
  if (!cleanMessage) {
    return { ok: false, skipped: true, reason: "missing_message" };
  }

  const trackingUrl = `${buildOrderTrackingUrl(sale)}?chat=1#chat`;
  const partnerName = await resolvePartnerName(prisma, sale);
  const text = `${partnerName}: ${cleanMessage} Responde: ${trackingUrl}`;
  const smsEstimate = estimateSmsParts(text);

  const reservation = await reserveSmsCreditForMessage(prisma, {
    partnerId: sale.partnerId,
    couponCode: sale.code,
    customerId: sale.customerId,
    to,
    quantity: smsEstimate.parts,
    meta: { smsEstimate },
  });

  if (!reservation.ok) {
    return { ok: false, skipped: true, reason: reservation.error, trackingUrl };
  }

  const result = await sendTelnyxSms({
    to,
    text,
    tags: [`order:${sale.id}`, `order-chat:${sale.code}`, `partner:${sale.partnerId}`],
  });

  if (!result.ok) {
    await refundSmsCreditForMessage(prisma, {
      partnerId: sale.partnerId,
      couponCode: sale.code,
      customerId: sale.customerId,
      reason: result.error?.title || "order_chat_sms_failed",
      quantity: smsEstimate.parts,
      meta: { smsEstimate },
    }).catch((error) => {
      console.error("[order-notifications.chat-sms] refund error:", error);
    });
  }

  return {
    ...result,
    trackingUrl,
    ledgerId: reservation.ledgerId,
  };
}
