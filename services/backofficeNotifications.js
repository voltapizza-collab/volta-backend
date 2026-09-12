import { backofficeAnnouncements } from "../data/backofficeAnnouncements.js";

export const NOTIFICATION_TARGETS = ["sms-credits", "communications", "settings", "settings-tracking"];
const priority = { critical: 0, urgent: 1, warning: 2, info: 3 };

export function validateAnnouncement(item) {
  if (!item || !/^[a-z0-9][a-z0-9-]{2,100}$/.test(item.id || "")) return false;
  if (!Number.isInteger(item.revision) || item.revision < 1) return false;
  if (!["improvement", "maintenance", "notice"].includes(item.category)) return false;
  if (!Object.hasOwn(priority, item.severity)) return false;
  if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 140) return false;
  if (typeof item.message !== "string" || !item.message.trim() || item.message.length > 1500) return false;
  if (item.detail != null && (typeof item.detail !== "string" || item.detail.length > 1500)) return false;
  if (!Number.isFinite(Date.parse(item.publishedAt))) return false;
  if (item.expiresAt != null && !(Date.parse(item.expiresAt) > Date.parse(item.publishedAt))) return false;
  if (item.partnerIds != null && (!Array.isArray(item.partnerIds) || !item.partnerIds.length ||
    !item.partnerIds.every((id) => Number.isSafeInteger(id) && id > 0))) return false;
  if (item.action != null && (!NOTIFICATION_TARGETS.includes(item.action.target) ||
    typeof item.action.label !== "string" || !item.action.label.trim() || item.action.label.length > 80)) return false;
  if (item.translations != null) {
    if (typeof item.translations !== "object" || Array.isArray(item.translations)) return false;
    for (const [locale, content] of Object.entries(item.translations)) {
      if (!["es", "en", "it", "fr", "pt"].includes(locale) || !content || typeof content !== "object") return false;
      for (const [field, maxLength] of [["title", 140], ["message", 1500]]) {
        if (typeof content[field] !== "string" || !content[field].trim() || content[field].length > maxLength) return false;
      }
      if (content.detail != null && (typeof content.detail !== "string" || content.detail.length > 1500)) return false;
      if (item.action && (typeof content.actionLabel !== "string" || !content.actionLabel.trim() || content.actionLabel.length > 80)) return false;
    }
  }
  return true;
}

export function buildSmsBalanceNotification(partner) {
  const balance = partner.smsCredits;
  // Unknown balances must never be presented as zero.
  if (!Number.isInteger(balance)) return null;
  const threshold = Number.isInteger(partner.smsLowBalanceThreshold)
    ? Math.max(10, partner.smsLowBalanceThreshold) : 50;
  if (balance > threshold) return null;
  const remaining = Math.max(0, balance);
  const severity = remaining === 0 ? "critical" : remaining <= 10 ? "urgent" : "warning";
  return {
    id: "sms-balance",
    // Keep the same key while the balance moves within a severity level.
    revision: severity,
    category: "sms",
    severity,
    requiresAction: true,
    remaining,
    title: remaining === 0 ? "Te has quedado sin mensajes" : `Te ${remaining === 1 ? "queda 1 mensaje" : `quedan ${remaining} mensajes`}`,
    message: remaining === 0
      ? "Tus SMS no pueden enviarse por falta de saldo. Recarga ahora para reactivar los mensajes a tus clientes."
      : remaining <= 10
        ? "Es urgente que recargues. Evita que los avisos a tus clientes y las campañas se queden sin mensajes."
        : "Tu saldo de SMS está bajando. Recarga con tiempo para seguir enviando mensajes a tus clientes.",
    detail: "El saldo se comparte entre las tiendas de tu negocio. Los SMS largos pueden consumir más de un crédito.",
    action: { label: "Recargar ahora", target: "sms-credits" },
  };
}

export function buildBackofficeNotifications(partner, { now = new Date(), announcements = backofficeAnnouncements } = {}) {
  const time = new Date(now).getTime();
  const notices = announcements
    .filter((item) => validateAnnouncement(item) && Date.parse(item.publishedAt) <= time &&
      (!item.expiresAt || Date.parse(item.expiresAt) > time) &&
      (!item.partnerIds || item.partnerIds.includes(partner.id)))
    .map(({ partnerIds, ...item }) => ({ ...item, requiresAction: false }));
  const sms = buildSmsBalanceNotification(partner);
  if (sms) notices.push(sms);
  return notices.sort((a, b) => priority[a.severity] - priority[b.severity] ||
    Number(b.requiresAction) - Number(a.requiresAction) ||
    (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
}
