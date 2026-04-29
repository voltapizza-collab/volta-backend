import express from "express";
import { verifyTelnyxWebhookSignature } from "../services/telnyx.js";

const router = express.Router();
const COUPON_CODE_PATTERN = /\bVOL-(?:RC|PF|CD|CS)[A-Z0-9]{6}\b/i;

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

export default function telnyxWebhooksRoutes(prisma) {
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

    updateCouponMessageStatus(prisma, req.body).catch((error) => {
      console.error("[webhooks.telnyx] error:", error);
    });
  });

  return router;
}
