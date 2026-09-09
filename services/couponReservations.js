import { evaluateCoupon } from "./couponEvaluation.js";

const fail = (code, details) => { const error = new Error(code); error.status = 409; error.details = details; throw error; };

// All allocation and consumption paths lock the coupon row before checking capacity.
export async function lockCheckoutCoupon(tx, { partnerId, code, ...context }) {
  const rows = await tx.$queryRawUnsafe("SELECT * FROM `Coupon` WHERE partnerId = ? AND code = ? FOR UPDATE", partnerId, code);
  const coupon = rows[0];
  const evaluation = evaluateCoupon(coupon, context);
  if (!evaluation.valid) fail("coupon_not_applicable", { couponStatus: evaluation.status, message: evaluation.message });
  if (!coupon.usageUnlimited) {
    const held = await tx.$queryRawUnsafe("SELECT saleId FROM `CouponReservation` WHERE couponId = ? AND status = 'RESERVED' FOR UPDATE", coupon.id);
    if (Number(coupon.usedCount || 0) + held.length >= Number(coupon.usageLimit ?? 1))
      fail("coupon_reserved", { message: "Los usos disponibles de este cupón están reservados en pagos pendientes. Inténtalo de nuevo al terminar o caducar esos pagos." });
  }
  return { coupon, evaluation };
}

export async function reserveCouponForSale(tx, coupon, sale) {
  if (coupon && !coupon.usageUnlimited) {
    await tx.couponReservation.create({ data: { couponId: coupon.id, saleId: sale.id } });
  }
}

export async function releaseCouponReservation(prisma, session) {
  if (session.metadata?.purpose !== "order_checkout" || session.payment_status === "paid") return;
  const saleId = Number(session.metadata.saleId);
  if (!Number.isInteger(saleId) || saleId <= 0) return;
  await prisma.$transaction(async tx => {
    const sales = await tx.$queryRawUnsafe("SELECT id, status, stripeCheckoutSessionId FROM `Sale` WHERE id = ? FOR UPDATE", saleId);
    const sale = sales[0];
    if (!sale || sale.status === "PAID" || (sale.stripeCheckoutSessionId && sale.stripeCheckoutSessionId !== session.id)) return;
    await tx.couponReservation.updateMany({ where: { saleId, status: "RESERVED" }, data: { status: "RELEASED" } });
  });
}

// Expired local clocks never release a payable session. Stripe is the authority.
// This fallback recovers missed expiry webhooks when the same limited coupon is retried.
export async function reconcileCouponReservations(prisma, couponId, retrieveSession) {
  const pending = await prisma.couponReservation.findMany({ where: { couponId, status: "RESERVED",
    createdAt: { lt: new Date(Date.now() - 35 * 60 * 1000) }, stripeSessionId: { not: null } }, take: 20 });
  for (const reservation of pending) {
    const session = await retrieveSession(reservation.stripeSessionId);
    if (session.status === "expired") await releaseCouponReservation(prisma, session);
  }
}
