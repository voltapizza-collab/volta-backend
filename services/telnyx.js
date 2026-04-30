import axios from "axios";
import crypto from "crypto";

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const cleanEnv = (value) => String(value || "").trim();

const telnyxConfig = () => ({
  apiKey: cleanEnv(process.env.TELNYX_API_KEY),
  messagingProfileId: cleanEnv(process.env.TELNYX_MESSAGING_PROFILE_ID),
  senderId: cleanEnv(process.env.TELNYX_SENDER_ID),
  webhookUrl: cleanEnv(process.env.TELNYX_WEBHOOK_URL),
  webhookPublicKey: cleanEnv(process.env.TELNYX_WEBHOOK_PUBLIC_KEY),
});

export const validateTelnyxEnv = ({ requireWebhookPublicKey = false } = {}) => {
  const config = telnyxConfig();
  const missing = [];
  const warnings = [];

  if (!config.apiKey) missing.push("TELNYX_API_KEY");
  if (!config.messagingProfileId) missing.push("TELNYX_MESSAGING_PROFILE_ID");
  if (!config.senderId) missing.push("TELNYX_SENDER_ID");
  if (requireWebhookPublicKey && !config.webhookPublicKey) {
    missing.push("TELNYX_WEBHOOK_PUBLIC_KEY");
  }
  if (!config.webhookUrl) warnings.push("TELNYX_WEBHOOK_URL is not set");
  if (config.senderId && config.senderId.startsWith("+")) {
    warnings.push("TELNYX_SENDER_ID should be an alphanumeric sender ID, not a phone number");
  }

  return {
    enabled: missing.length === 0,
    missing,
    warnings,
    webhookConfigured: Boolean(config.webhookUrl),
    webhookSignatureConfigured: Boolean(config.webhookPublicKey),
  };
};

export const getTelnyxStatus = validateTelnyxEnv;

export const normalizeE164Phone = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (raw.startsWith("+")) {
    const digits = raw.replace(/[^\d]/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00") && digits.length >= 10 && digits.length <= 17) {
    return `+${digits.slice(2)}`;
  }

  if (digits.length === 9) return `+34${digits}`;
  if (digits.length === 11 && digits.startsWith("34")) return `+${digits}`;

  return null;
};

const normalizeTelnyxError = (error) => {
  const response = error?.response;
  const firstError = Array.isArray(response?.data?.errors) ? response.data.errors[0] : null;

  return {
    statusCode: response?.status || null,
    code: firstError?.code || null,
    title: firstError?.title || error?.message || "telnyx_error",
    detail: firstError?.detail || null,
  };
};

export async function sendTelnyxSms({ to, text, tags = [] }) {
  const config = telnyxConfig();
  const status = getTelnyxStatus();

  if (!status.enabled) {
    return {
      ok: false,
      skipped: true,
      status: "skipped",
      error: {
        title: "telnyx_not_configured",
        missing: status.missing,
      },
    };
  }

  const toPhone = normalizeE164Phone(to);
  if (!toPhone) {
    return {
      ok: false,
      status: "failed",
      error: {
        title: "invalid_phone",
      },
    };
  }

  try {
    const payload = {
      // TELNYX_SENDER_ID is intended to be a configurable alphanumeric sender ID.
      from: config.senderId,
      to: toPhone,
      text,
      type: "SMS",
      messaging_profile_id: config.messagingProfileId,
      use_profile_webhooks: true,
      ...(tags.length ? { tags } : {}),
      ...(config.webhookUrl ? { webhook_url: config.webhookUrl } : {}),
    };

    const response = await axios.post(TELNYX_MESSAGES_URL, payload, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const data = response.data?.data || {};
    const recipient = Array.isArray(data.to) ? data.to[0] : null;

    return {
      ok: true,
      status: recipient?.status || "queued",
      providerMessageId: data.id || null,
      to: toPhone,
      parts: data.parts || null,
      cost: data.cost || null,
      sentAt: data.sent_at || data.received_at || new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      to: toPhone,
      error: normalizeTelnyxError(error),
    };
  }
}

const readRawPublicKey = (publicKey) => {
  const normalized = cleanEnv(publicKey);
  if (!normalized) return null;

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length === 32) {
    return crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, decoded]),
      format: "der",
      type: "spki",
    });
  }

  return crypto.createPublicKey({
    key: decoded,
    format: "der",
    type: "spki",
  });
};

export function verifyTelnyxWebhookSignature({ rawBody, signature, timestamp }) {
  if (process.env.TELNYX_SKIP_WEBHOOK_VERIFY === "true") {
    return { ok: true, skipped: true };
  }

  let publicKey = null;
  try {
    publicKey = readRawPublicKey(process.env.TELNYX_WEBHOOK_PUBLIC_KEY);
  } catch {
    return { ok: false, error: "bad_public_key" };
  }

  if (!publicKey) {
    return { ok: false, error: "missing_public_key" };
  }

  if (!signature || !timestamp) {
    return { ok: false, error: "missing_signature" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, error: "bad_timestamp" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, error: "stale_timestamp" };
  }

  try {
    const signedPayload = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
    const signatureBytes = Buffer.from(signature, "base64");
    const ok = crypto.verify(null, signedPayload, publicKey, signatureBytes);

    return ok ? { ok: true } : { ok: false, error: "invalid_signature" };
  } catch {
    return { ok: false, error: "invalid_signature" };
  }
}
