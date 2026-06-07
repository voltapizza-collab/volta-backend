import axios from "axios";
import crypto from "crypto";

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";
const TELNYX_BALANCE_URL = "https://api.telnyx.com/v2/balance";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ" +
  " !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ`¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€";

const cleanEnv = (value) => String(value || "").trim();
const SMS_MAX_PARTS = 1;
const OBSERVED_SMS_PART_COST_EUR = "0.0620";
const SMS_GSM_BASIC =
  "\n\r !\"#$%&'()*+,-./0123456789:;<=>?" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SMS_GSM_EXTENDED = "^{}\\[~]|";

const telnyxConfig = () => ({
  apiKey: cleanEnv(process.env.TELNYX_API_KEY),
  messagingProfileId: cleanEnv(process.env.TELNYX_MESSAGING_PROFILE_ID),
  senderId: cleanEnv(process.env.SMS_SENDER_ID) || cleanEnv(process.env.TELNYX_SENDER_ID),
  webhookUrl: cleanEnv(process.env.TELNYX_WEBHOOK_URL),
  webhookPublicKey: cleanEnv(process.env.TELNYX_WEBHOOK_PUBLIC_KEY),
});

export const validateTelnyxEnv = ({ requireWebhookPublicKey = false } = {}) => {
  const config = telnyxConfig();
  const missing = [];
  const warnings = [];

  if (!config.apiKey) missing.push("TELNYX_API_KEY");
  if (!config.messagingProfileId) missing.push("TELNYX_MESSAGING_PROFILE_ID");
  if (!config.senderId) missing.push("SMS_SENDER_ID");
  if (requireWebhookPublicKey && !config.webhookPublicKey) {
    missing.push("TELNYX_WEBHOOK_PUBLIC_KEY");
  }
  if (!config.webhookUrl) warnings.push("TELNYX_WEBHOOK_URL is not set");
  if (config.senderId && config.senderId.startsWith("+")) {
    warnings.push("SMS_SENDER_ID should be an alphanumeric sender ID, not a phone number");
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

export async function getTelnyxBalanceDetails() {
  const config = telnyxConfig();

  if (!config.apiKey) {
    return {
      ok: false,
      error: {
        title: "telnyx_not_configured",
        missing: ["TELNYX_API_KEY"],
      },
    };
  }

  try {
    const response = await axios.get(TELNYX_BALANCE_URL, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      proxy: false,
      timeout: 15000,
    });

    const data = response.data?.data || {};

    return {
      ok: true,
      recordType: data.record_type || "balance",
      pending: data.pending || null,
      balance: data.balance || null,
      creditLimit: data.credit_limit || null,
      availableCredit: data.available_credit || data.balance || null,
      currency: data.currency || null,
      raw: data,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeTelnyxError(error),
    };
  }
}

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

export function estimateSmsParts(text = "") {
  const value = String(text || "");
  const isGsm = [...value].every((char) => SMS_GSM_BASIC.includes(char) || SMS_GSM_EXTENDED.includes(char));
  const length = [...value].reduce((total, char) => total + (SMS_GSM_EXTENDED.includes(char) ? 2 : 1), 0);
  const singleLimit = isGsm ? 160 : 70;
  const multipartLimit = isGsm ? 153 : 67;
  const parts = length <= singleLimit ? 1 : Math.ceil(length / multipartLimit);

  return {
    encoding: isGsm ? "GSM-7" : "UCS-2",
    length,
    parts: Math.max(parts || 1, 1),
    singleLimit,
    multipartLimit,
  };
}

export function validateOnePartSms(text = "") {
  const estimate = estimateSmsParts(text);
  return {
    ok: estimate.parts <= SMS_MAX_PARTS,
    maxParts: SMS_MAX_PARTS,
    observedPartCostEur: Number(OBSERVED_SMS_PART_COST_EUR),
    ...estimate,
  };
}

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
  const smsLimit = validateOnePartSms(text);

  if (!smsLimit.ok) {
    return {
      ok: false,
      status: "failed",
      skipped: true,
      error: {
        title: "sms_too_long",
        detail: "SMS text exceeds the 1-part limit.",
        parts: smsLimit.parts,
        maxParts: smsLimit.maxParts,
        length: smsLimit.length,
        encoding: smsLimit.encoding,
      },
    };
  }

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
      // SMS_SENDER_ID is intended to be a configurable alphanumeric sender ID.
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
      proxy: false,
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
      estimatedParts: smsLimit.parts,
      estimatedCostEur: Number(OBSERVED_SMS_PART_COST_EUR),
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
