import express from "express";
import { verifyTelnyxWebhookSignature } from "../services/telnyx.js";

const COUPON_CODE_PATTERN = /\bVOL-(?:RC|PF|CD|CS)[A-Z0-9]{6}\b/i;
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

const readMetaObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
};

const normalizeErrors = (errors) => {
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => ({
    code: error?.code || null,
    title: error?.title || null,
    detail: error?.detail || null,
  }));
};

const extractCouponCode = (payload = {}) => {
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const tagCode = tags
    .map((tag) => String(tag || ""))
    .find((tag) => tag.toLowerCase().startsWith("coupon:"));

  if (tagCode) {
    const code = tagCode.slice("coupon:".length).trim().toUpperCase();
    if (COUPON_CODE_PATTERN.test(code)) return code;
  }

  const match = String(payload.text || "").match(COUPON_CODE_PATTERN);
  return match ? match[0].toUpperCase() : null;
};

const firstRecipient = (payload = {}) => (Array.isArray(payload.to) ? payload.to[0] : null);

const normalizePhoneDigits = (value = "") => String(value || "").replace(/[^\d]/g, "");

const phoneLookups = (phoneNumber) => {
  const digits = normalizePhoneDigits(phoneNumber);
  if (!digits) return [];

  const variants = new Set([digits]);
  if (digits.startsWith("34") && digits.length === 11) variants.add(digits.slice(2));
  if (digits.length === 9) variants.add(`34${digits}`);

  return [...variants];
};

async function updateCouponMessageStatus(prisma, event) {
  const data = event?.data || {};
  const payload = data.payload || {};
  const eventType = data.event_type || null;

  if (!["message.sent", "message.finalized"].includes(eventType)) {
    return { ignored: true, reason: "event_type" };
  }

  const couponCode = extractCouponCode(payload);
  if (!couponCode) {
    return { ignored: true, reason: "coupon_code" };
  }

  const coupon = await prisma.coupon.findUnique({
    where: { code: couponCode },
    select: {
      id: true,
      meta: true,
    },
  });

  if (!coupon) {
    return { ignored: true, reason: "coupon_not_found" };
  }

  const meta = readMetaObject(coupon.meta);
  const currentMessage = readMetaObject(meta.message);
  const recipient = firstRecipient(payload);
  const nextStatus =
    recipient?.status ||
    (eventType === "message.sent" ? "sent" : null) ||
    currentMessage.status ||
    "unknown";

  const occurredAt = data.occurred_at || new Date().toISOString();
  const nextMessage = {
    ...currentMessage,
    provider: "telnyx",
    providerMessageId: payload.id || currentMessage.providerMessageId || null,
    eventId: data.id || currentMessage.eventId || null,
    eventType,
    status: nextStatus,
    to: recipient?.phone_number || currentMessage.to || null,
    from: payload.from?.phone_number || payload.from?.sender_id || currentMessage.from || null,
    cost: payload.cost || currentMessage.cost || null,
    errors: normalizeErrors(payload.errors),
    updatedAt: occurredAt,
    ...(eventType === "message.finalized" ? { finalizedAt: occurredAt } : {}),
  };

  await prisma.coupon.update({
    where: { id: coupon.id },
    data: {
      meta: {
        ...meta,
        messageStatus: nextStatus,
        message: nextMessage,
      },
    },
  });

  return { ok: true, couponCode, status: nextStatus };
}

async function handleStopOptOut(prisma, event) {
  const data = event?.data || {};
  const payload = data.payload || {};

  if (data.event_type !== "message.received") {
    return { ignored: true, reason: "event_type" };
  }

  const text = String(payload.text || "").trim().toUpperCase();
  if (!STOP_WORDS.has(text)) {
    return { ignored: true, reason: "not_stop" };
  }

  const from = payload.from?.phone_number || payload.from?.number || "";
  const lookups = phoneLookups(from);
  if (!lookups.length) {
    return { ignored: true, reason: "phone" };
  }

  const updated = await prisma.customer.updateMany({
    where: {
      OR: lookups.flatMap((phone) => [
        { phone },
        { phone: `+${phone}` },
        { phone: { endsWith: phone } },
      ]),
    },
    data: {
      isRestricted: true,
      restrictedAt: new Date(),
      restrictionReason: "SMS_STOP",
    },
  });

  return { ok: true, restricted: updated.count };
}

export default function telnyxWebhooksRoutes(prisma) {
  const router = express.Router();

  router.post("/telnyx", (req, res) => {
    const verification = verifyTelnyxWebhookSignature({
      rawBody: req.rawBody || JSON.stringify(req.body || {}),
      signature: req.get("telnyx-signature-ed25519"),
      timestamp: req.get("telnyx-timestamp"),
    });

    if (!verification.ok) {
      return res.status(403).json({ ok: false, error: "invalid_signature" });
    }

    res.status(200).json({ ok: true });

    Promise.all([
      updateCouponMessageStatus(prisma, req.body),
      handleStopOptOut(prisma, req.body),
    ]).catch((error) => {
      console.error("[webhooks.telnyx] error:", error);
    });
  });

  return router;
}
