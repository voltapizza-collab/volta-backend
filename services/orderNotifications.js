import { reserveSmsCreditForMessage, refundSmsCreditForMessage } from "./smsCredits.js";
import { normalizeE164Phone, sendTelnyxSms } from "./telnyx.js";

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

export async function sendOrderPaidTrackingSms(prisma, sale) {
  const data = readCustomerData(sale);
  const to = normalizeE164Phone(data.phone || sale?.customer?.phone);
  if (!to) {
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const trackingUrl = buildOrderTrackingUrl(sale);
  const text = [
    `Pago confirmado, ${customerFirstName(sale)}.`,
    `Tu pedido ${sale.code} ya entro en cocina.`,
    `Sigue el estado aqui: ${trackingUrl}`,
  ].join(" ");

  const reservation = await reserveSmsCreditForMessage(prisma, {
    partnerId: sale.partnerId,
    couponCode: sale.code,
    customerId: sale.customerId,
    to,
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
  const data = readCustomerData(sale);
  const to = normalizeE164Phone(data.phone || sale?.customer?.phone);
  if (!to) {
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const storeName = sale?.store?.storeName || "la tienda";
  const isDelivery = sale.delivery === "COURIER";
  const text = isDelivery
    ? `Tu pedido ${sale.code} va en camino desde ${storeName}. Gracias por tu compra.`
    : `Tu pedido ${sale.code} esta listo para recoger en ${storeName}. Gracias por tu compra.`;

  const reservation = await reserveSmsCreditForMessage(prisma, {
    partnerId: sale.partnerId,
    couponCode: sale.code,
    customerId: sale.customerId,
    to,
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
  const data = readCustomerData(sale);
  const to = normalizeE164Phone(data.phone || sale?.customer?.phone);
  if (!to) {
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const cleanMessage = String(message || "").trim().replace(/\s+/g, " ").slice(0, 240);
  if (!cleanMessage) {
    return { ok: false, skipped: true, reason: "missing_message" };
  }

  const trackingUrl = `${buildOrderTrackingUrl(sale)}?chat=1#chat`;
  const storeName = sale?.store?.storeName || "Volta Pizza";
  const text = `${storeName}: ${cleanMessage} Abre y responde aqui: ${trackingUrl}`;

  const reservation = await reserveSmsCreditForMessage(prisma, {
    partnerId: sale.partnerId,
    couponCode: sale.code,
    customerId: sale.customerId,
    to,
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
