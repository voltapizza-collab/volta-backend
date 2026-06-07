import express from "express";
import { estimateSmsParts, normalizeE164Phone, sendTelnyxSms } from "../services/telnyx.js";
import {
  reserveSmsCreditForMessage,
  refundSmsCreditForMessage,
} from "../services/smsCredits.js";
import { isPartnerSmsServiceEnabled } from "../services/smsNotificationSettings.js";

const VALID_SEGMENTS = ["S1", "S2", "S3", "S4", "S5"];
const VALID_ACTIVITIES = ["HOT", "COLD"];
const VALID_TARGET_TAGS = [...VALID_SEGMENTS, ...VALID_ACTIVITIES];

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(",");
  return [];
};

const normalizeTargetTags = (value) => [
  ...new Set(
    normalizeArray(value)
      .map((item) => String(item || "").trim().toUpperCase())
      .filter((item) => VALID_TARGET_TAGS.includes(item))
  ),
];

const splitTargetTags = (value) => {
  const tags = normalizeTargetTags(value);
  return {
    segments: tags.filter((item) => VALID_SEGMENTS.includes(item)),
    activities: tags.filter((item) => VALID_ACTIVITIES.includes(item)),
  };
};

const normalizeIds = (value) => [
  ...new Set(normalizeArray(value).map((item) => parsePositiveInt(item)).filter(Boolean)),
];

const normalizeZipCode = (value) => {
  const match = String(value || "").match(/\b(\d{5})\b/);
  return match ? match[1] : null;
};

const normalizeZipCodes = (value) => [
  ...new Set(normalizeArray(value).map((item) => normalizeZipCode(item)).filter(Boolean)),
];

const postalAreaKey = (postalCode) => {
  const digits = String(postalCode || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(0, 3) : "";
};

const uniqueCustomers = (rows = []) => {
  const map = new Map();
  rows.forEach((item) => {
    if (item?.id && !map.has(item.id)) map.set(item.id, item);
  });
  return Array.from(map.values());
};

const buildStoreRecipientScope = (storeIds, targetStores = []) => {
  if (!storeIds.length) return null;

  const storeZipCodes = [
    ...new Set(targetStores.map((store) => normalizeZipCode(store.zipCode)).filter(Boolean)),
  ];
  const storeAreas = [...new Set(storeZipCodes.map((zipCode) => postalAreaKey(zipCode)).filter(Boolean))];
  const storeCities = [
    ...new Set(targetStores.map((store) => String(store.city || "").trim()).filter(Boolean)),
  ];

  return {
    OR: [
      { sales: { some: { storeId: { in: storeIds } } } },
      ...storeZipCodes.flatMap((zipCode) => [{ zipCode }, { address_1: { contains: zipCode } }]),
      ...storeAreas.flatMap((area) => [
        { zipCode: { startsWith: area } },
        { address_1: { contains: area } },
      ]),
      ...storeCities.map((city) => ({ address_1: { contains: city } })),
    ],
  };
};

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  segment: true,
  activity: true,
  zipCode: true,
  isRestricted: true,
};

const resolveTargetStores = async (prisma, partnerId, storeIds) => {
  if (!storeIds.length) return [];

  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds }, partnerId },
    select: { id: true, storeName: true, city: true, zipCode: true },
  });

  if (stores.length !== storeIds.length) {
    const error = new Error("bad_store_ids");
    error.code = "bad_store_ids";
    throw error;
  }

  return stores;
};

const resolveRecipients = async (
  prisma,
  { partnerId, audienceMode, customerIds, segments, activities, storeIds, zipCodes, targetStores }
) => {
  if (audienceMode === "ONE") {
    if (!customerIds.length) return [];

    return prisma.customer.findMany({
      where: {
        partnerId,
        id: { in: customerIds },
        isRestricted: false,
      },
      select: customerSelect,
    });
  }

  const zipWhere = zipCodes.length
    ? {
        OR: zipCodes.flatMap((zipCode) => [{ zipCode }, { address_1: { contains: zipCode } }]),
      }
    : null;
  const storeWhere = buildStoreRecipientScope(storeIds, targetStores);
  const hasFilters = segments.length || activities.length || storeIds.length || zipCodes.length;

  if (audienceMode !== "ALL" && !hasFilters) return [];

  const rows = await prisma.customer.findMany({
    where: {
      partnerId,
      isRestricted: false,
      ...(segments.length ? { segment: { in: segments } } : {}),
      ...(activities.length ? { activity: { in: activities } } : {}),
      ...(storeWhere || zipWhere ? { AND: [storeWhere, zipWhere].filter(Boolean) } : {}),
    },
    select: customerSelect,
  });

  return uniqueCustomers(rows);
};

const sanitizeMessage = (value) => String(value || "").replace(/\s+/g, " ").trim();

const cleanSmsPart = (value) => String(value || "").replace(/\s+/g, " ").trim();

const buildCampaignText = ({ partnerName, message }) => {
  const brand = cleanSmsPart(partnerName || process.env.TELNYX_SMS_BRAND || "VoltaPizza");
  return cleanSmsPart(`${brand}: ${message}. STOP`);
};

const telnyxConcurrency = () => {
  const parsed = Number(process.env.TELNYX_SEND_CONCURRENCY);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 5;
};

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    })
  );

  return results;
}

const summarizeDelivery = (items) => {
  const errors = items
    .filter((item) => !item.ok && item.error)
    .map((item) => ({
      customerId: item.customerId || null,
      code: item.error.code || null,
      statusCode: item.error.statusCode || null,
      title: item.error.title || null,
      detail: item.error.detail || null,
    }));

  return {
    provider: "telnyx",
    total: items.length,
    sent: items.filter((item) => item.ok).length,
    failed: items.filter((item) => !item.ok && !item.skipped).length,
    skipped: items.filter((item) => item.skipped).length,
    statuses: items.reduce((summary, item) => {
      summary[item.status] = (summary[item.status] || 0) + 1;
      return summary;
    }, {}),
    errors: errors.slice(0, 5),
  };
};

const parseCampaignPayload = (body = {}) => {
  const partnerId = parsePositiveInt(body.partnerId);
  const audienceMode = ["ONE", "FILTERED", "ALL"].includes(String(body.audienceMode || "").toUpperCase())
    ? String(body.audienceMode).toUpperCase()
    : "FILTERED";
  const { segments, activities } = splitTargetTags(body.segments);

  return {
    partnerId,
    audienceMode,
    customerIds: normalizeIds(body.customerIds),
    segments,
    activities,
    storeIds: normalizeIds(body.storeIds),
    zipCodes: normalizeZipCodes(body.zipCodes),
    message: sanitizeMessage(body.message),
  };
};

const buildPreview = (recipients, text = "") => {
  const validRecipients = recipients.filter((recipient) => normalizeE164Phone(recipient.phone));
  const smsEstimate = estimateSmsParts(text);

  return {
    recipients: recipients.length,
    validPhones: validRecipients.length,
    invalidPhones: recipients.length - validRecipients.length,
    smsPartsPerRecipient: smsEstimate.parts,
    estimatedCreditsRequired: validRecipients.length * smsEstimate.parts,
    smsEncoding: smsEstimate.encoding,
    smsLength: smsEstimate.length,
    sample: recipients.slice(0, 8).map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      phone: recipient.phone,
      segment: recipient.segment,
      activity: recipient.activity,
      zipCode: recipient.zipCode,
      canSend: Boolean(normalizeE164Phone(recipient.phone)),
    })),
  };
};

const sendCampaignSms = async (prisma, { partnerId, campaignId, recipients, text }) => {
  const smsEstimate = estimateSmsParts(text);
  const items = recipients.map((recipient) => ({
    recipient,
    to: normalizeE164Phone(recipient.phone),
  }));

  return mapWithConcurrency(items, telnyxConcurrency(), async ({ recipient, to }) => {
    if (!to) {
      return {
        customerId: recipient.id,
        ok: false,
        status: "failed",
        skipped: true,
        error: { title: "invalid_recipient_phone" },
      };
    }

    const reservation = await reserveSmsCreditForMessage(prisma, {
      partnerId,
      couponCode: campaignId,
      customerId: recipient.id,
      to,
      quantity: smsEstimate.parts,
      meta: {
        smsEstimate,
      },
    });

    if (!reservation.ok) {
      return {
        customerId: recipient.id,
        ok: false,
        status: "skipped",
        skipped: true,
        error: {
          title: reservation.error || "insufficient_sms_credits",
          balance: reservation.balance || 0,
        },
      };
    }

    const result = await sendTelnyxSms({
      to,
      text,
      tags: [`campaign:${campaignId}`, `customer:${recipient.id}`],
    });

    if (!result.ok) {
      try {
        await refundSmsCreditForMessage(prisma, {
          partnerId,
          couponCode: campaignId,
          customerId: recipient.id,
          quantity: smsEstimate.parts,
          reason: result.error?.title || result.status,
          meta: {
            smsEstimate,
          },
        });
      } catch (refundError) {
        console.error("[communications.sms] refund error:", refundError);
      }
    }

    return {
      customerId: recipient.id,
      ok: Boolean(result.ok),
      status: result.status,
      skipped: Boolean(result.skipped),
      error: result.error || null,
      providerMessageId: result.providerMessageId || null,
    };
  });
};

export default function communicationsRoutes(prisma) {
  const router = express.Router();

  router.post("/sms/preview", async (req, res) => {
    const payload = parseCampaignPayload(req.body);
    if (!payload.partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId_required" });
    }

    try {
      const targetStores = await resolveTargetStores(prisma, payload.partnerId, payload.storeIds);
      const partnerName = await prisma.partner.findUnique({
        where: { id: payload.partnerId },
        select: { name: true },
      });
      const text = buildCampaignText({ partnerName: partnerName?.name, message: payload.message });
      const recipients = await resolveRecipients(prisma, { ...payload, targetStores });

      return res.json({
        ok: true,
        ...buildPreview(recipients, text),
      });
    } catch (error) {
      console.error("[communications.preview] error:", error);
      return res.status(400).json({ ok: false, error: error.code || error.message || "preview_failed" });
    }
  });

  router.post("/sms/send", async (req, res) => {
    const payload = parseCampaignPayload(req.body);
    if (!payload.partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId_required" });
    }

    if (payload.message.length < 3 || payload.message.length > 120) {
      return res.status(400).json({ ok: false, error: "bad_message" });
    }

    try {
      const [partner, targetStores] = await Promise.all([
        prisma.partner.findUnique({
          where: { id: payload.partnerId },
          select: { id: true, name: true, smsCredits: true },
        }),
        resolveTargetStores(prisma, payload.partnerId, payload.storeIds),
      ]);

      if (!partner) {
        return res.status(404).json({ ok: false, error: "partner_not_found" });
      }

      const campaignSmsEnabled = await isPartnerSmsServiceEnabled(prisma, {
        partnerId: payload.partnerId,
        serviceId: "smsCampaignDelivery",
      });
      if (!campaignSmsEnabled) {
        return res.status(403).json({ ok: false, error: "sms_service_disabled" });
      }

      const recipients = await resolveRecipients(prisma, { ...payload, targetStores });
      if (!recipients.length) {
        return res.status(400).json({ ok: false, error: "no_recipients" });
      }

      const text = buildCampaignText({ partnerName: partner.name, message: payload.message });
      const preview = buildPreview(recipients, text);
      const validRecipients = recipients.filter((recipient) => normalizeE164Phone(recipient.phone));
      if (!validRecipients.length) {
        return res.status(400).json({ ok: false, error: "no_valid_phones", recipients: recipients.length });
      }

      if (preview.smsPartsPerRecipient > 1) {
        return res.status(400).json({
          ok: false,
          error: "sms_too_long",
          smsPartsPerRecipient: preview.smsPartsPerRecipient,
          smsLength: preview.smsLength,
          smsEncoding: preview.smsEncoding,
          maxParts: 1,
        });
      }

      if ((partner.smsCredits || 0) < preview.estimatedCreditsRequired) {
        return res.status(402).json({
          ok: false,
          error: "insufficient_sms_credits",
          balance: partner.smsCredits || 0,
          required: preview.estimatedCreditsRequired,
          smsPartsPerRecipient: preview.smsPartsPerRecipient,
          validPhones: preview.validPhones,
        });
      }

      const campaignId = `sms-campaign-${payload.partnerId}-${Date.now()}`;
      const results = await sendCampaignSms(prisma, {
        partnerId: payload.partnerId,
        campaignId,
        recipients,
        text,
      });

      return res.json({
        ok: true,
        campaignId,
        preview,
        delivery: summarizeDelivery(results),
      });
    } catch (error) {
      console.error("[communications.send] error:", error);
      return res.status(400).json({ ok: false, error: error.code || error.message || "send_failed" });
    }
  });

  return router;
}
