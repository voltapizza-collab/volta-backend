import crypto from "crypto";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

const getStripeSecretKey = () => process.env.STRIPE_SECRET_KEY?.trim();
const getStripeWebhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET?.trim();

export const isStripeCheckoutConfigured = () => Boolean(getStripeSecretKey());
export const isStripeWebhookConfigured = () => Boolean(getStripeWebhookSecret());

const appendParam = (params, key, value) => {
  if (value !== undefined && value !== null && value !== "") {
    params.append(key, String(value));
  }
};

const stripeRequest = async (path, params, idempotencyKey) => {
  if (!globalThis.fetch) {
    throw new Error("fetch_not_available");
  }

  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error("stripe_not_configured");
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: params,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data?.error?.message || "stripe_request_failed";
    const error = new Error(message);
    error.statusCode = response.status;
    error.stripeError = data?.error;
    throw error;
  }

  return data;
};

export const createSmsCreditsCheckoutSession = async ({
  partner,
  amountCents,
  credits,
  successUrl,
  cancelUrl,
}) => {
  const params = new URLSearchParams();
  const partnerId = String(partner.id);
  const creditsLabel = new Intl.NumberFormat("es-ES").format(credits);

  appendParam(params, "mode", "payment");
  appendParam(params, "success_url", successUrl);
  appendParam(params, "cancel_url", cancelUrl);
  appendParam(params, "client_reference_id", `sms:${partnerId}`);
  appendParam(params, "line_items[0][quantity]", 1);
  appendParam(params, "line_items[0][price_data][currency]", "eur");
  appendParam(params, "line_items[0][price_data][unit_amount]", amountCents);
  appendParam(params, "line_items[0][price_data][product_data][name]", `Paquete Volta SMS - ${creditsLabel} mensajes`);
  appendParam(params, "line_items[0][price_data][product_data][description]", partner.name);
  appendParam(params, "metadata[purpose]", "sms_credit_purchase");
  appendParam(params, "metadata[partnerId]", partnerId);
  appendParam(params, "metadata[credits]", credits);
  appendParam(params, "metadata[amountCents]", amountCents);
  appendParam(params, "payment_intent_data[metadata][purpose]", "sms_credit_purchase");
  appendParam(params, "payment_intent_data[metadata][partnerId]", partnerId);
  appendParam(params, "payment_intent_data[metadata][credits]", credits);
  appendParam(params, "payment_intent_data[metadata][amountCents]", amountCents);

  return stripeRequest(
    "/checkout/sessions",
    params,
    `sms-credits-${partnerId}-${amountCents}-${credits}-${Date.now()}`
  );
};

const parseStripeSignature = (header = "") =>
  String(header)
    .split(",")
    .reduce((acc, item) => {
      const [key, value] = item.split("=");
      if (!key || !value) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(value);
      return acc;
    }, {});

const safeCompare = (left, right) => {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const constructStripeWebhookEvent = (payload, signatureHeader) => {
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    throw new Error("stripe_webhook_not_configured");
  }

  const signatures = parseStripeSignature(signatureHeader);
  const timestamp = signatures.t?.[0];
  const v1Signatures = signatures.v1 || [];

  if (!timestamp || !v1Signatures.length) {
    throw new Error("bad_stripe_signature");
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const valid = v1Signatures.some((signature) => safeCompare(expectedSignature, signature));
  if (!valid) {
    throw new Error("bad_stripe_signature");
  }

  return JSON.parse(payload);
};
