import express from "express";
import { normalizeSmsNotificationSettings } from "../services/smsNotificationSettings.js";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

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

const formatAgeMinutes = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
};

const trackingTimeZone = () => process.env.TIMEZONE || "Europe/Madrid";

export const formatAlertTimestampES = (value) => {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return new Intl.DateTimeFormat("es-ES", {
    timeZone: trackingTimeZone(),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(safeDate)
    .replace(",", "");
};

const withVisibleTimestamp = (message, timestampLabel) =>
  timestampLabel ? `${String(message || "").trim()} Momento: ${timestampLabel}.` : String(message || "").trim();

const getLineQty = (line) => {
  const qty = Number(line?.quantity ?? line?.qty ?? line?.cantidad ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
};

const getSaleProductSummary = (sale) => {
  const products = asArray(sale.products)
    .filter((line) => String(line?.source || "").toLowerCase() !== "coupon")
    .map((line) => {
      const name = String(line?.name || line?.pizzaName || line?.title || "Producto").trim();
      return `${name} x${getLineQty(line)}`;
    })
    .slice(0, 3);

  return products.join(", ");
};

const normalizeTrackingSettings = normalizeSmsNotificationSettings;

const isServiceEnabled = (settings, serviceId) =>
  Boolean(settings.enabled && settings.services?.[serviceId]);

export const buildAlert = ({
  id,
  type,
  serviceId,
  severity = "info",
  title,
  message,
  occurredAt,
  entity = {},
  meta = {},
  settings,
}) => {
  const timestampLabel = formatAlertTimestampES(occurredAt);

  return {
    id,
    type,
    serviceId,
    severity,
    title,
    message: withVisibleTimestamp(message, timestampLabel),
    occurredAt,
    timestampLabel,
    enabled: isServiceEnabled(settings, serviceId),
    entity,
    meta: {
      ...meta,
      timestampLabel,
    },
  };
};

export default function trackingAlertsRoutes(prisma) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const limit = Math.max(1, Math.min(parsePositiveInt(req.query.limit) || 60, 100));

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId required" });
    }

    try {
      const partnerRows = await prisma.$queryRawUnsafe(
        "SELECT id, trackingNotificationSettings FROM Partner WHERE id = ?",
        partnerId
      );
      const partner = partnerRows?.[0] || null;

      if (!partner) {
        return res.status(404).json({ ok: false, error: "partner_not_found" });
      }

      const settings = normalizeTrackingSettings(partner.trackingNotificationSettings);
      const pendingMinutes = Math.max(
        1,
        Math.min(
          parsePositiveInt(req.query.pendingMinutes) ||
            Number(settings.delayedOrderThresholdMinutes || 3),
          180
        )
      );
      const pendingCutoff = new Date(Date.now() - pendingMinutes * 60000);
      const baseSaleWhere = {
        partnerId,
        ...(storeId ? { storeId } : {}),
      };

      const [
        pendingOrders,
        couponRedemptions,
        recentSales,
        storeAverages,
        stores,
        inactiveIngredients,
        canceledReservations,
        boostSales,
      ] = await Promise.all([
        prisma.sale.findMany({
          where: {
            ...baseSaleWhere,
            status: "PAID",
            processed: false,
            OR: [
              { date: { lte: pendingCutoff } },
              { createdAt: { lte: pendingCutoff } },
            ],
          },
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          take: 20,
          include: {
            store: { select: { id: true, storeName: true, slug: true } },
            customer: { select: { id: true, name: true, phone: true } },
          },
        }),
        prisma.couponRedemption.findMany({
          where: {
            partnerId,
            ...(storeId ? { storeId } : {}),
          },
          orderBy: { redeemedAt: "desc" },
          take: 20,
          include: {
            store: { select: { id: true, storeName: true, slug: true } },
            customer: { select: { id: true, name: true, phone: true, segment: true } },
            sale: { select: { id: true, code: true, total: true, currency: true } },
            coupon: { select: { id: true, code: true, campaign: true, acquisition: true, channel: true } },
          },
        }),
        prisma.sale.findMany({
          where: {
            ...baseSaleWhere,
            status: { not: "CANCELED" },
            total: { gt: 0 },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 80,
          include: {
            store: { select: { id: true, storeName: true, slug: true } },
            customer: { select: { id: true, name: true, phone: true } },
          },
        }),
        prisma.sale.groupBy({
          by: ["storeId"],
          where: {
            partnerId,
            ...(storeId ? { storeId } : {}),
            status: { not: "CANCELED" },
            total: { gt: 0 },
          },
          _avg: { total: true },
          _count: { _all: true },
        }),
        prisma.store.findMany({
          where: {
            partnerId,
            ...(storeId ? { id: storeId } : {}),
          },
          orderBy: [{ active: "asc" }, { acceptingOrders: "asc" }, { updatedAt: "desc" }],
          take: 40,
        }),
        prisma.storeIngredientStock.findMany({
          where: {
            active: false,
            store: {
              partnerId,
              ...(storeId ? { id: storeId } : {}),
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 30,
          include: {
            store: { select: { id: true, storeName: true, slug: true } },
            ingredient: { select: { id: true, name: true, category: true, status: true } },
          },
        }),
        prisma.reservation.findMany({
          where: {
            partnerId,
            status: "CANCELED",
            ...(storeId ? { storeId } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: 30,
          include: {
            store: { select: { id: true, storeName: true, slug: true } },
          },
        }),
        prisma.sale.findMany({
          where: {
            ...baseSaleWhere,
            boostActive: true,
            boostPaidAt: { not: null },
          },
          orderBy: { boostPaidAt: "desc" },
          take: 30,
          include: {
            store: { select: { id: true, storeName: true, slug: true } },
            customer: { select: { id: true, name: true, phone: true } },
          },
        }),
      ]);

      const alerts = [];
      const avgByStoreId = new Map(
        storeAverages.map((row) => [
          Number(row.storeId),
          {
            average: Number(row._avg.total || 0),
            count: Number(row._count?._all || 0),
          },
        ])
      );

      pendingOrders.forEach((sale) => {
        const occurredAt = sale.date || sale.createdAt;
        const ageMinutes = formatAgeMinutes(occurredAt);
        const customerData = asObject(sale.customerData);
        alerts.push(buildAlert({
          id: `pending-order-${sale.id}`,
          type: "pending_order_unaccepted",
          serviceId: "pendingOrderUnaccepted",
          severity: ageMinutes >= pendingMinutes * 2 ? "danger" : "warning",
          title: `Pedido sin aceptar: ${sale.code}`,
          message: `${sale.store?.storeName || "Tienda"} tiene un pedido pagado sin aceptar desde hace ${ageMinutes || pendingMinutes} min.`,
          occurredAt,
          entity: {
            saleId: sale.id,
            code: sale.code,
            storeId: sale.storeId,
            storeName: sale.store?.storeName || "",
            customerName: customerData.name || sale.customer?.name || "",
          },
          meta: {
            ageMinutes,
            thresholdMinutes: pendingMinutes,
            total: Number(sale.total || 0),
            currency: sale.currency || "EUR",
            products: getSaleProductSummary(sale),
          },
          settings,
        }));
      });

      couponRedemptions.forEach((redemption) => {
        alerts.push(buildAlert({
          id: `coupon-redemption-${redemption.id}`,
          type: "coupon_gallery_redeemed",
          serviceId: "couponRedeemed",
          severity: "success",
          title: `Cupon canjeado: ${redemption.couponCode}`,
          message: `${redemption.customer?.name || "Cliente"} canjeo un cupon${redemption.store?.storeName ? ` en ${redemption.store.storeName}` : ""}.`,
          occurredAt: redemption.redeemedAt || redemption.createdAt,
          entity: {
            redemptionId: redemption.id,
            couponId: redemption.couponId,
            couponCode: redemption.couponCode,
            saleId: redemption.saleId,
            saleCode: redemption.sale?.code || "",
            storeId: redemption.storeId,
            storeName: redemption.store?.storeName || "",
            customerId: redemption.customerId,
            customerName: redemption.customer?.name || "",
          },
          meta: {
            source: redemption.acquisition === "CLAIM" ? "Coupon Gallery" : redemption.channel || "Cupon",
            saleTotal: Number(redemption.sale?.total || 0),
            discountValue: Number(redemption.discountValue || 0),
            currency: redemption.sale?.currency || "EUR",
          },
          settings,
        }));
      });

      recentSales.forEach((sale) => {
        const storeAverage = avgByStoreId.get(Number(sale.storeId));
        if (!storeAverage || storeAverage.count < 2) return;

        const saleTotal = Number(sale.total || 0);
        const averageTicket = Number(storeAverage.average || 0);
        if (!averageTicket || saleTotal <= averageTicket) return;

        const customerData = asObject(sale.customerData);
        alerts.push(buildAlert({
          id: `high-ticket-sale-${sale.id}`,
          type: "high_average_ticket_sale",
          serviceId: "highAverageTicketSale",
          severity: saleTotal >= averageTicket * 1.5 ? "success" : "info",
          title: `Venta sobre ticket promedio: ${sale.code}`,
          message: `${sale.store?.storeName || "Tienda"} vendio ${saleTotal.toFixed(2)} ${sale.currency || "EUR"} sobre un promedio de ${averageTicket.toFixed(2)}.`,
          occurredAt: sale.date || sale.createdAt,
          entity: {
            saleId: sale.id,
            code: sale.code,
            storeId: sale.storeId,
            storeName: sale.store?.storeName || "",
            customerName: customerData.name || sale.customer?.name || "",
          },
          meta: {
            total: saleTotal,
            averageTicket,
            liftPercent: Math.round(((saleTotal - averageTicket) / averageTicket) * 100),
            currency: sale.currency || "EUR",
            products: getSaleProductSummary(sale),
          },
          settings,
        }));
      });

      stores.forEach((store) => {
        const isOpen = Boolean(store.active && store.acceptingOrders);
        alerts.push(buildAlert({
          id: `store-status-${store.id}`,
          type: "store_open_closed",
          serviceId: "storeOpenClosed",
          severity: isOpen ? "success" : "warning",
          title: isOpen ? `Tienda abierta: ${store.storeName}` : `Tienda cerrada: ${store.storeName}`,
          message: isOpen
            ? `${store.storeName} esta activa y aceptando pedidos.`
            : `${store.storeName} no esta aceptando pedidos ahora mismo.`,
          occurredAt: store.updatedAt || store.createdAt,
          entity: {
            storeId: store.id,
            storeName: store.storeName,
            slug: store.slug,
          },
          meta: {
            active: Boolean(store.active),
            acceptingOrders: Boolean(store.acceptingOrders),
            city: store.city || "",
          },
          settings,
        }));
      });

      inactiveIngredients.forEach((row) => {
        alerts.push(buildAlert({
          id: `ingredient-disabled-${row.storeId}-${row.ingredientId}`,
          type: "ingredient_disabled",
          serviceId: "ingredientDisabled",
          severity: "warning",
          title: `Ingrediente desactivado: ${row.ingredient?.name || row.ingredientId}`,
          message: `${row.ingredient?.name || "Ingrediente"} esta desactivado en ${row.store?.storeName || "la tienda"}.`,
          occurredAt: row.updatedAt || row.createdAt,
          entity: {
            storeId: row.storeId,
            storeName: row.store?.storeName || "",
            ingredientId: row.ingredientId,
            ingredientName: row.ingredient?.name || "",
          },
          meta: {
            stock: Number(row.stock || 0),
            category: row.ingredient?.category || "",
            ingredientStatus: row.ingredient?.status || "",
          },
          settings,
        }));
      });

      canceledReservations.forEach((reservation) => {
        alerts.push(buildAlert({
          id: `reservation-canceled-${reservation.id}`,
          type: "reservation_canceled",
          serviceId: "reservationCanceled",
          severity: "warning",
          title: `Reserva cancelada: ${reservation.customerName || reservation.id}`,
          message: `${reservation.customerName || "Cliente"} cancelo una reserva en ${reservation.store?.storeName || "la tienda"}.`,
          occurredAt: reservation.updatedAt || reservation.createdAt,
          entity: {
            reservationId: reservation.id,
            storeId: reservation.storeId,
            storeName: reservation.store?.storeName || "",
            customerName: reservation.customerName || "",
          },
          meta: {
            reservationDate: reservation.reservationDate,
            reservationTime: reservation.reservationTime || "",
            partySize: Number(reservation.partySize || 0),
            customerPhone: reservation.customerPhone || "",
          },
          settings,
        }));
      });

      boostSales.forEach((sale) => {
        const customerData = asObject(sale.customerData);
        const amount = Number(sale.boostAmount || 0);
        alerts.push(buildAlert({
          id: `boost-purchased-${sale.id}`,
          type: "boost_purchased",
          serviceId: "boostPurchased",
          severity: "success",
          title: `Boost comprado: ${sale.code}`,
          message: `${customerData.name || sale.customer?.name || "Cliente"} compro Boost en ${sale.store?.storeName || "la tienda"}.`,
          occurredAt: sale.boostPaidAt || sale.updatedAt || sale.createdAt,
          entity: {
            saleId: sale.id,
            code: sale.code,
            storeId: sale.storeId,
            storeName: sale.store?.storeName || "",
            customerName: customerData.name || sale.customer?.name || "",
          },
          meta: {
            amount,
            currency: sale.currency || "EUR",
            targetPosition: sale.boostTargetPosition || null,
            queueCredit: Number(sale.boostQueueCredit || 0),
          },
          settings,
        }));
      });

      alerts.sort((left, right) => {
        const leftTime = new Date(left.occurredAt || 0).getTime();
        const rightTime = new Date(right.occurredAt || 0).getTime();
        return rightTime - leftTime;
      });

      const items = alerts.slice(0, limit);
      const summary = items.reduce(
        (result, alert) => {
          result.total += 1;
          result.enabled += alert.enabled ? 1 : 0;
          result.byType[alert.serviceId] = (result.byType[alert.serviceId] || 0) + 1;
          result.bySeverity[alert.severity] = (result.bySeverity[alert.severity] || 0) + 1;
          return result;
        },
        { total: 0, enabled: 0, byType: {}, bySeverity: {} }
      );

      return res.json({
        ok: true,
        partnerId,
        generatedAt: new Date().toISOString(),
        settings,
        summary,
        items,
      });
    } catch (error) {
      console.error("[tracking-alerts] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  return router;
}
