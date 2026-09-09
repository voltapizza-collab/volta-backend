const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const json = (value, fallback = {}) => {
  try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; }
  catch { return fallback; }
};
const list = (value) => { const parsed = json(value, []); return Array.isArray(parsed) ? parsed : []; };
export const isDeliveryFreeCoupon = (coupon) =>
  String(coupon?.campaign || "").toUpperCase() === "DELIVERY_FREE" ||
  String(coupon?.code || "").toUpperCase().startsWith("VOL-DF") ||
  Boolean(json(coupon?.meta).deliveryFree) ||
  (coupon?.kind === "AMOUNT" && coupon?.variant === "FIXED" && coupon?.amount != null && Number(coupon.amount) === 0);

export const calculateCouponDiscount = (coupon, subtotal, { deliveryFee = 0 } = {}) => {
  if (isDeliveryFreeCoupon(coupon)) return money(Math.max(0, deliveryFee));
  const base = Math.max(0, money(subtotal));
  if (coupon.kind === "AMOUNT") return money(Math.max(0, Math.min(Number(coupon.amount || 0), base)));
  if (coupon.kind !== "PERCENT") return 0;
  return money(Math.max(0, Math.min(base, base * Number(coupon.percent || 0) / 100,
    coupon.maxAmount == null ? Infinity : Number(coupon.maxAmount))));
};

export function evaluateCoupon(coupon, { eligibleSubtotal = 0, deliveryFee = 0, store,
  hasProducts = false, reference = new Date(), timeZone = process.env.TIMEZONE || "Europe/Madrid" } = {}) {
  const minAmount = Math.max(0, Number(coupon?.minAmount || 0));
  const missingAmount = money(Math.max(0, minAmount - eligibleSubtotal));
  const result = (status, message) => ({ valid: status === "valid", status, message,
    minAmount, missingAmount, subtotal: money(eligibleSubtotal),
    discount: status === "valid" ? calculateCouponDiscount(coupon, eligibleSubtotal, { deliveryFee }) : 0 });
  if (!coupon) return result("not_found", "Cupón no encontrado.");
  if (coupon.status !== "ACTIVE") return result(String(coupon.status || "inactive").toLowerCase(),
    coupon.status === "USED" ? "Este cupón ya alcanzó su límite de usos." :
    coupon.status === "EXPIRED" ? "Este cupón ya caducó." : "Este cupón no está activo.");
  if (!coupon.usageUnlimited && Number(coupon.usedCount || 0) >= Number(coupon.usageLimit ?? 1))
    return result("used", "Este cupón ya alcanzó su límite de usos.");
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= reference) return result("expired", "Este cupón ya caducó.");
  if (coupon.activeFrom && new Date(coupon.activeFrom) > reference) return result("not_started", "Este cupón todavía no está activo.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone,
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(reference).map(p => [p.type, p.value]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const names = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const rawDays = typeof coupon.daysActive === "string" && !coupon.daysActive.startsWith("[")
    ? coupon.daysActive.split(",") : list(coupon.daysActive);
  const days = rawDays.map(d => typeof d === "number" ? d : names.indexOf(String(d).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const start = Number(coupon.windowStart ?? 0), end = Number(coupon.windowEnd ?? 1440);
  if ((days.length && !days.includes(day)) || (start <= end ? minutes < start || minutes >= end : minutes < start && minutes >= end))
    return result("outside_window", "Este cupón no está disponible en este horario.");
  const meta = json(coupon.meta), targeting = meta.targeting || {};
  const storeIds = list(targeting.storeIds).map(Number), zips = list(targeting.zipCodes).map(String);
  // The selected store is authoritative for both preview and checkout, including claimed coupons.
  if ((storeIds.length || zips.length) && !storeIds.includes(Number(store?.id)) && !zips.includes(String(store?.zipCode || "")))
    return result("wrong_area", "Este cupón no está disponible para esta tienda.");
  if (isDeliveryFreeCoupon(coupon) && deliveryFee <= 0) return result("no_delivery_fee", "Este cupón necesita un pedido con gastos de envío.");
  if (!isDeliveryFreeCoupon(coupon) && eligibleSubtotal <= 0) return result(hasProducts ? "no_eligible_products" : "empty_cart",
    hasProducts ? "Estos productos ya tienen descuento o no admiten cupón. Añade productos sin oferta; Top Deals, Promos, Boost y recompensas quedan excluidos."
      : "Cupón guardado. Añade productos sin oferta y el descuento se aplicará automáticamente.");
  if (missingAmount > 0) return result("min_not_met", `El cupón requiere EUR ${minAmount.toFixed(2)} en productos sin oferta. Faltan EUR ${missingAmount.toFixed(2)}.`);
  return result("valid", "Cupón aplicado. El descuento solo afecta a los productos compatibles.");
}
