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

const asArray = (value) => {
  const parsed = parseMaybeJson(parseMaybeJson(value, []), []);
  return Array.isArray(parsed) ? parsed : [];
};

const normalizePhone = (value) =>
  String(value || "")
    .replace(/[^\d+]/g, "")
    .slice(0, 24);

const normalizePositiveIds = (value) =>
  Array.from(
    new Set(
      asArray(value)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );

const normalizePerStoreServices = (value) => {
  const source = asObject(value);

  return Object.entries(source).reduce((result, [storeId, services]) => {
    const normalizedStoreId = Number(storeId);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) return result;

    const sourceServices = asObject(services);
    result[String(normalizedStoreId)] = SMS_NOTIFICATION_SERVICE_IDS.reduce((serviceResult, serviceId) => {
      serviceResult[serviceId] = Boolean(sourceServices[serviceId]);
      return serviceResult;
    }, {});
    return result;
  }, {});
};

export const SMS_NOTIFICATION_SERVICE_IDS = [
  "customerPaymentSuccess",
  "customerOrderReady",
  "customerOrderChatMessage",
  "customerReviewRequest",
  "customerReservationConfirmation",
  "customerScheduledOrderConfirmation",
  "privateCouponDelivery",
  "gameCouponDelivery",
  "smsCampaignDelivery",
  "pendingOrderUnaccepted",
  "couponRedeemed",
  "highAverageTicketSale",
  "storeOpenClosed",
  "ingredientDisabled",
  "reservationCanceled",
  "boostPurchased",
];

export const INTERNAL_SMS_SERVICE_IDS = [
  "pendingOrderUnaccepted",
  "couponRedeemed",
  "highAverageTicketSale",
  "storeOpenClosed",
  "ingredientDisabled",
  "reservationCanceled",
  "boostPurchased",
];

export const SMS_NOTIFICATION_SETTINGS_VERSION = 2;

export const normalizeSmsNotificationSettings = (value) => {
  const source = asObject(value);
  const sourceServices = asObject(source.services);
  const schemaVersion = Number(source.schemaVersion || 0);
  const canReadSavedServices = schemaVersion >= SMS_NOTIFICATION_SETTINGS_VERSION;
  const perStoreServices = canReadSavedServices ? normalizePerStoreServices(source.perStoreServices) : {};
  const rawThreshold = Number(source.delayedOrderThresholdMinutes);
  const primaryPhone = normalizePhone(source.recipientPhone);
  const extraRecipientPhones = asArray(source.extraRecipientPhones)
    .map(normalizePhone)
    .filter((phone) => phone && phone !== primaryPhone)
    .slice(0, 8);

  const services = SMS_NOTIFICATION_SERVICE_IDS.reduce((result, serviceId) => {
    result[serviceId] = canReadSavedServices ? Boolean(sourceServices[serviceId]) : false;
    return result;
  }, {});

  return {
    schemaVersion: SMS_NOTIFICATION_SETTINGS_VERSION,
    enabled: canReadSavedServices && Boolean(source.enabled),
    channel: "SMS",
    recipientPhone: primaryPhone,
    extraRecipientPhones,
    contactPhoneConfirmed: Boolean(source.contactPhoneConfirmed),
    contactPhoneConfirmedAt: source.contactPhoneConfirmed
      ? String(source.contactPhoneConfirmedAt || new Date().toISOString())
      : null,
    delayedOrderThresholdMinutes:
      Number.isInteger(rawThreshold) && rawThreshold >= 1 && rawThreshold <= 180
        ? rawThreshold
        : 3,
    storeIds: normalizePositiveIds(source.storeIds),
    perStoreServices,
    services,
  };
};

export const isSmsNotificationServiceEnabled = (settings, serviceId, { storeId } = {}) => {
  const normalized = normalizeSmsNotificationSettings(settings);
  if (!normalized.enabled) return false;

  const normalizedStoreId = Number(storeId);
  if (Number.isInteger(normalizedStoreId) && normalizedStoreId > 0) {
    const storeServices = normalized.perStoreServices[String(normalizedStoreId)];
    if (!storeServices && !Object.keys(normalized.perStoreServices || {}).length) {
      return Boolean(normalized.services[serviceId]);
    }
    return Boolean(storeServices?.[serviceId]);
  }

  if (!normalized.services[serviceId]) return false;

  if (storeId && normalized.storeIds.length && !normalized.storeIds.includes(Number(storeId))) {
    return false;
  }

  return true;
};

export const getSmsNotificationRecipients = (settings) => {
  const normalized = normalizeSmsNotificationSettings(settings);
  if (!normalized.contactPhoneConfirmed) return [];

  return Array.from(
    new Set([normalized.recipientPhone, ...normalized.extraRecipientPhones].map(normalizePhone).filter(Boolean))
  );
};

export async function getPartnerSmsNotificationSettings(prisma, partnerId) {
  const id = Number(partnerId);
  if (!Number.isInteger(id) || id <= 0) return normalizeSmsNotificationSettings(null);

  const partner = await prisma.partner.findUnique({
    where: { id },
    select: { trackingNotificationSettings: true },
  });

  return normalizeSmsNotificationSettings(partner?.trackingNotificationSettings);
}

export async function isPartnerSmsServiceEnabled(prisma, { partnerId, serviceId, storeId } = {}) {
  const settings = await getPartnerSmsNotificationSettings(prisma, partnerId);
  return isSmsNotificationServiceEnabled(settings, serviceId, { storeId });
}
