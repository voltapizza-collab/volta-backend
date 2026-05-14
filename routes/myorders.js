import express from "express";
import { getBoostSettings } from "../services/boostSettings.js";

const TZ = process.env.TIMEZONE || "Europe/Madrid";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseOptionalDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const nowInTZ = () => {
  const snapshot = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  return new Date(snapshot.replace(" ", "T"));
};

const startOfLocalDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfLocalWeek = (date) => {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return startOfLocalDay(addDays(date, mondayOffset));
};

const getPeriodRange = (period) => {
  const now = nowInTZ();

  if (period === "week") {
    const from = startOfLocalWeek(now);
    return {
      from,
      to: addDays(from, 7),
      label: "Semana actual",
    };
  }

  const from = startOfLocalDay(now);
  return {
    from,
    to: addDays(from, 1),
    label: "Hoy",
  };
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

const asArray = (value) => {
  const first = parseMaybeJson(value, []);
  const second = parseMaybeJson(first, []);
  return Array.isArray(second) ? second : [];
};

const asObject = (value) => {
  const parsed = parseMaybeJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const normalizePhone = (value) =>
  String(value || "")
    .replace(/[^\d+]/g, "")
    .trim();

const getLineQty = (item) => {
  const qty = Number(item?.quantity ?? item?.qty ?? item?.cantidad ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
};

const getLineName = (item) =>
  String(
    item?.name ||
      item?.pizzaName ||
      item?.title ||
      (item?.leftName && item?.rightName ? `${item.leftName} / ${item.rightName}` : "") ||
      (item?.pizzaId ? `Producto #${item.pizzaId}` : "Producto")
  ).trim();

const formatSale = (sale) => {
  const customerData = asObject(sale.customerData);
  const boostAmount =
    sale.boostAmount == null ? 0 : Number(sale.boostAmount || 0);

  return {
    id: sale.id,
    code: sale.code,
    date: sale.date,
    createdAt: sale.createdAt,
    type: sale.type,
    delivery: sale.delivery,
    status: sale.status,
    channel: sale.channel,
    currency: sale.currency,
    processed: sale.processed,
    total: Number(sale.total || 0),
    discounts: Number(sale.discounts || 0),
    boost: {
      active: Boolean(sale.boostActive),
      targetPosition: sale.boostTargetPosition,
      originalPosition: sale.boostOriginalPosition,
      queueCredit: Number(sale.boostQueueCredit || 0),
      amount: Number.isFinite(boostAmount) ? boostAmount : 0,
      paidAt: sale.boostPaidAt,
      meta: asObject(sale.boostMeta),
    },
    notes: sale.notes || "",
    storeId: sale.storeId,
    storeName: sale.store?.storeName || "",
    storeSlug: sale.store?.slug || "",
    partnerId: sale.partnerId,
    partnerName: sale.partner?.name || "",
    customerId: sale.customerId,
    customerData: {
      name: customerData.name || sale.customer?.name || "",
      phone: customerData.phone || sale.customer?.phone || "",
      email: customerData.email || sale.customer?.email || "",
      address_1: customerData.address_1 || sale.address_1 || sale.customer?.address_1 || "",
      portal: customerData.portal || sale.customer?.portal || "",
      observations: customerData.observations || sale.customer?.observations || "",
    },
    products: asArray(sale.products),
    extras: asArray(sale.extras),
  };
};

const buildRepeatCartDraft = (sale) => {
  const formatted = formatSale(sale);
  const items = formatted.products.map((item, index) => ({
    ...item,
    repeatLineId: `${sale.id}-${index}`,
    quantity: getLineQty(item),
  }));

  return {
    source: "repeat_last_order",
    sourceOrderId: sale.id,
    sourceOrderCode: sale.code,
    partnerId: sale.partnerId,
    partnerName: sale.partner?.name || "",
    storeId: sale.storeId,
    storeName: sale.store?.storeName || "",
    storeSlug: sale.store?.slug || "",
    currency: sale.currency || sale.partner?.currency || "EUR",
    customerId: sale.customerId,
    customerData: formatted.customerData,
    items,
    extras: formatted.extras,
    totalProducts: Number(sale.totalProducts || 0),
    discounts: formatted.discounts,
    total: formatted.total,
    editable: true,
    clearable: true,
    createdFromOrderAt: sale.date || sale.createdAt,
  };
};

const findRepeatSales = async (
  prisma,
  { partnerId, storeId, customerId, phone, rawPhone, take = 1 }
) => {
  const matchingCustomerIds = phone
    ? (
        await prisma.customer.findMany({
          where: {
            partnerId,
            OR: [
              { phone: { contains: phone } },
              ...(rawPhone && rawPhone !== phone
                ? [{ phone: { contains: rawPhone } }]
                : []),
            ],
          },
          select: { id: true },
          take: 10,
        })
      ).map((customer) => customer.id)
    : [];

  return prisma.sale.findMany({
    where: {
      partnerId,
      ...(storeId ? { storeId } : {}),
      status: { not: "CANCELED" },
      OR: [
        ...(customerId ? [{ customerId }] : []),
        ...(matchingCustomerIds.length
          ? [{ customerId: { in: matchingCustomerIds } }]
          : []),
        ...(phone
          ? [
              {
                customerData: {
                  path: "$.phone",
                  string_contains: phone,
                },
              },
            ]
          : []),
        ...(rawPhone && rawPhone !== phone
          ? [
              {
                customerData: {
                  path: "$.phone",
                  string_contains: rawPhone,
                },
              },
            ]
          : []),
      ],
    },
    include: {
      partner: { select: { id: true, name: true, currency: true } },
      store: { select: { id: true, storeName: true, slug: true, active: true } },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address_1: true,
          portal: true,
          observations: true,
        },
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
  });
};

const orderScopeWhere = ({ partnerId, storeId, activeStoresOnly = true }) => ({
  ...(partnerId ? { partnerId } : {}),
  ...(storeId ? { storeId } : {}),
  ...(activeStoresOnly ? { store: { active: true } } : {}),
});

const pendingOrderWhere = ({ partnerId, storeId, activeStoresOnly = true }) => ({
  ...orderScopeWhere({ partnerId, storeId, activeStoresOnly }),
  processed: false,
  status: { in: ["PENDING", "PAID"] },
});

const queueOrderBy = [
  { boostActive: "desc" },
  { boostTargetPosition: "asc" },
  { boostQueueCredit: "desc" },
  { boostPaidAt: "asc" },
  { date: "asc" },
  { createdAt: "asc" },
];

const clampTargetPosition = (value, currentPosition) => {
  const parsed = parsePositiveInt(value) || 1;
  return Math.min(Math.max(parsed, 1), Math.max(currentPosition, 1));
};

const buildBoostQuote = ({ sale, queue, targetPosition, settings }) => {
  const currentIndex = queue.findIndex((item) => item.id === sale.id);
  const currentPosition = currentIndex >= 0 ? currentIndex + 1 : queue.length + 1;
  const target = clampTargetPosition(targetPosition, currentPosition);
  const positionsToJump = Math.max(currentPosition - target, 0);
  const unitPrice = settings.unitPrice;
  const amount = roundMoney(positionsToJump * unitPrice);
  const voltaAmount = roundMoney(amount * (settings.voltaSharePercent / 100));
  const partnerAmount = roundMoney(amount - voltaAmount);

  return {
    orderId: sale.id,
    code: sale.code,
    storeId: sale.storeId,
    storeName: sale.store?.storeName || "",
    partnerId: sale.partnerId,
    partnerName: sale.partner?.name || "",
    currency: sale.currency || sale.partner?.currency || "EUR",
    currentPosition,
    targetPosition: target,
    positionsToJump,
    unitPrice,
    amount,
    voltaSharePercent: settings.voltaSharePercent,
    partnerSharePercent: settings.partnerSharePercent,
    voltaAmount,
    partnerAmount,
    alreadyBoosted: Boolean(sale.boostActive),
    paidAt: sale.boostPaidAt,
  };
};

const findBoostableSale = async (prisma, { orderId, orderCode }) => {
  const id = parsePositiveInt(orderId);
  const code = String(orderCode || "").trim().toUpperCase();

  if (!id && !code) return null;

  return prisma.sale.findFirst({
    where: {
      ...(id ? { id } : { code }),
      processed: false,
      status: { in: ["PENDING", "PAID"] },
    },
    include: {
      partner: { select: { id: true, name: true, currency: true } },
      store: { select: { id: true, storeName: true, slug: true, active: true } },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address_1: true,
          portal: true,
          observations: true,
        },
      },
    },
  });
};

const loadStoreQueue = (prisma, sale) =>
  prisma.sale.findMany({
    where: pendingOrderWhere({
      partnerId: sale.partnerId,
      storeId: sale.storeId,
      activeStoresOnly: false,
    }),
    select: {
      id: true,
      code: true,
      date: true,
      createdAt: true,
      boostActive: true,
      boostTargetPosition: true,
      boostQueueCredit: true,
      boostPaidAt: true,
    },
    orderBy: queueOrderBy,
  });

export default function myordersRoutes(prisma) {
  const router = express.Router();

  router.get("/repeat/recent", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const customerId = parsePositiveInt(req.query.customerId);
    const rawPhone = String(req.query.phone || "").trim();
    const phone = normalizePhone(req.query.phone);

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId requerido" });
    }

    if (!customerId && !phone) {
      return res.status(400).json({ error: "Telefono o customerId requerido" });
    }

    try {
      const sales = await findRepeatSales(prisma, {
        partnerId,
        storeId,
        customerId,
        phone,
        rawPhone,
        take: 3,
      });

      return res.json({
        ok: true,
        orders: sales.map((sale) => ({
          order: formatSale(sale),
          cartDraft: buildRepeatCartDraft(sale),
        })),
      });
    } catch (error) {
      console.error("[myorders.repeat.recent] error:", error);
      return res.status(500).json({ error: "Error buscando pedidos anteriores" });
    }
  });

  router.get("/repeat/latest", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const customerId = parsePositiveInt(req.query.customerId);
    const rawPhone = String(req.query.phone || "").trim();
    const phone = normalizePhone(req.query.phone);

    if (!partnerId) {
      return res.status(400).json({ error: "partnerId requerido" });
    }

    if (!customerId && !phone) {
      return res.status(400).json({ error: "Telefono o customerId requerido" });
    }

    try {
      const [sale] = await findRepeatSales(prisma, {
        partnerId,
        storeId,
        customerId,
        phone,
        rawPhone,
        take: 1,
      });

      if (!sale) {
        return res.status(404).json({ error: "No encontramos un pedido anterior para repetir" });
      }

      return res.json({
        ok: true,
        order: formatSale(sale),
        cartDraft: buildRepeatCartDraft(sale),
      });
    } catch (error) {
      console.error("[myorders.repeat.latest] error:", error);
      return res.status(500).json({ error: "Error buscando el ultimo pedido" });
    }
  });

  router.get("/boosts/quote", async (req, res) => {
    try {
      const sale = await findBoostableSale(prisma, {
        orderId: req.query.orderId,
        orderCode: req.query.orderCode || req.query.code,
      });

      if (!sale) {
        return res.status(404).json({ error: "Pedido pendiente no encontrado" });
      }

      const queue = await loadStoreQueue(prisma, sale);
      const settings = await getBoostSettings(prisma);
      if (!settings.active) {
        return res.status(409).json({ error: "Boost no esta activo ahora mismo" });
      }

      const quote = buildBoostQuote({
        sale,
        queue,
        targetPosition: req.query.targetPosition,
        settings,
      });

      return res.json({ ok: true, quote });
    } catch (error) {
      console.error("[myorders.boosts.quote] error:", error);
      return res.status(500).json({ error: "Error cotizando Boots" });
    }
  });

  router.post("/boosts/activate", async (req, res) => {
    try {
      const sale = await findBoostableSale(prisma, {
        orderId: req.body?.orderId,
        orderCode: req.body?.orderCode || req.body?.code,
      });

      if (!sale) {
        return res.status(404).json({ error: "Pedido pendiente no encontrado" });
      }

      const queue = await loadStoreQueue(prisma, sale);
      const settings = await getBoostSettings(prisma);
      if (!settings.active) {
        return res.status(409).json({ error: "Boost no esta activo ahora mismo" });
      }

      const quote = buildBoostQuote({
        sale,
        queue,
        targetPosition: req.body?.targetPosition,
        settings,
      });

      if (quote.positionsToJump <= 0) {
        return res.status(409).json({
          error: "Este pedido ya esta en la mejor posicion disponible",
          quote,
        });
      }

      const updated = await prisma.sale.update({
        where: { id: sale.id },
        data: {
          boostActive: true,
          boostTargetPosition: quote.targetPosition,
          boostOriginalPosition: sale.boostOriginalPosition || quote.currentPosition,
          boostQueueCredit: quote.positionsToJump,
          boostAmount: quote.amount,
          boostPaidAt: new Date(),
          boostMeta: {
            source: "storefront_footer",
            paymentMode: req.body?.paymentMode || "manual_mvp",
            paymentReference: req.body?.paymentReference || null,
            quotedAt: new Date().toISOString(),
            unitPrice: quote.unitPrice,
            voltaSharePercent: quote.voltaSharePercent,
            partnerSharePercent: quote.partnerSharePercent,
            voltaAmount: quote.voltaAmount,
            partnerAmount: quote.partnerAmount,
            previousTargetPosition: sale.boostTargetPosition || null,
          },
        },
        include: {
          partner: { select: { id: true, name: true, currency: true } },
          store: { select: { id: true, storeName: true, slug: true, active: true } },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              address_1: true,
              portal: true,
              observations: true,
            },
          },
        },
      });

      return res.json({
        ok: true,
        quote,
        order: formatSale(updated),
      });
    } catch (error) {
      console.error("[myorders.boosts.activate] error:", error);
      return res.status(500).json({ error: "Error activando Boots" });
    }
  });

  router.get("/pending", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const since = parseOptionalDate(req.query.since);
    const take = Math.min(parsePositiveInt(req.query.take) || 80, 200);

    try {
      const where = {
        ...pendingOrderWhere({ partnerId, storeId }),
        ...(since
          ? {
              OR: [
                { date: { gt: since } },
                { createdAt: { gt: since } },
              ],
            }
          : {}),
      };

      const [rows, queueSize] = await Promise.all([
        prisma.sale.findMany({
          where,
          include: {
            partner: { select: { id: true, name: true, currency: true } },
            store: { select: { id: true, storeName: true, slug: true, active: true } },
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                address_1: true,
                portal: true,
                observations: true,
              },
            },
          },
          orderBy: queueOrderBy,
          take,
        }),
        prisma.sale.count({ where }),
      ]);

      return res.json({
        items: rows.map((row, index) => ({
          ...formatSale(row),
          queuePosition: index + 1,
        })),
        queueSize,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[myorders.pending] error:", error);
      return res.status(500).json({ error: "Error loading pending orders" });
    }
  });

  router.get("/summary", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const period = String(req.query.period || "today").toLowerCase() === "week" ? "week" : "today";
    const { from, to, label } = getPeriodRange(period);
    const scope = orderScopeWhere({ partnerId, storeId });

    try {
      const [
        sales,
        pendingCount,
        newCustomers,
        activeStores,
        stores,
      ] = await Promise.all([
        prisma.sale.findMany({
          where: {
            ...scope,
            status: { not: "CANCELED" },
            date: { gte: from, lt: to },
          },
          include: {
            store: { select: { id: true, storeName: true, slug: true } },
            partner: { select: { id: true, name: true, currency: true } },
            customer: { select: { id: true } },
          },
          orderBy: { date: "desc" },
        }),
        prisma.sale.count({
          where: pendingOrderWhere({ partnerId, storeId }),
        }),
        prisma.customer.count({
          where: {
            ...(partnerId ? { partnerId } : {}),
            createdAt: { gte: from, lt: to },
          },
        }),
        prisma.store.count({
          where: {
            active: true,
            ...(partnerId ? { partnerId } : {}),
            ...(storeId ? { id: storeId } : {}),
          },
        }),
        prisma.store.findMany({
          where: {
            active: true,
            ...(partnerId ? { partnerId } : {}),
            ...(storeId ? { id: storeId } : {}),
          },
          select: {
            id: true,
            storeName: true,
            slug: true,
            partnerId: true,
            partner: { select: { name: true, currency: true } },
          },
          orderBy: [{ partnerId: "asc" }, { storeName: "asc" }],
        }),
      ]);

      const safeSales = sales.filter((sale) => Number.isFinite(Number(sale.total)));
      const revenue = safeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
      const ordersCount = safeSales.length;
      const averageTicket = ordersCount ? revenue / ordersCount : 0;
      const deliveryOrders = safeSales.filter((sale) => String(sale.delivery || sale.type || "").toUpperCase().includes("COURIER") || String(sale.type || "").toUpperCase().includes("DELIVERY")).length;
      const pickupOrders = Math.max(ordersCount - deliveryOrders, 0);
      const uniqueCustomers = new Set(safeSales.map((sale) => sale.customerId).filter(Boolean)).size;

      const storeMap = new Map();
      stores.forEach((store) => {
        storeMap.set(store.id, {
          storeId: store.id,
          storeName: store.storeName,
          partnerId: store.partnerId,
          partnerName: store.partner?.name || "",
          currency: store.partner?.currency || "EUR",
          pending: 0,
          orders: 0,
          revenue: 0,
        });
      });

      safeSales.forEach((sale) => {
        if (!storeMap.has(sale.storeId)) {
          storeMap.set(sale.storeId, {
            storeId: sale.storeId,
            storeName: sale.store?.storeName || "Tienda",
            partnerId: sale.partnerId,
            partnerName: sale.partner?.name || "",
            currency: sale.partner?.currency || "EUR",
            pending: 0,
            orders: 0,
            revenue: 0,
          });
        }

        const row = storeMap.get(sale.storeId);
        row.orders += 1;
        row.revenue += Number(sale.total || 0);
      });

      const pendingRows = await prisma.sale.groupBy({
        by: ["storeId"],
        where: pendingOrderWhere({ partnerId, storeId }),
        _count: { _all: true },
      });

      pendingRows.forEach((row) => {
        if (!storeMap.has(row.storeId)) return;
        storeMap.get(row.storeId).pending = row._count?._all || 0;
      });

      const productMap = new Map();
      safeSales.forEach((sale) => {
        asArray(sale.products).forEach((item) => {
          const name = getLineName(item);
          const qty = getLineQty(item);
          const current = productMap.get(name) || { name, qty: 0, revenue: 0 };
          current.qty += qty;
          current.revenue += Number(item?.total || item?.lineTotal || item?.price || item?.unitPrice || 0) * qty;
          productMap.set(name, current);
        });
      });

      const topProducts = [...productMap.values()]
        .sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name))
        .slice(0, 6);

      return res.json({
        period,
        periodLabel: label,
        from,
        to,
        currency: safeSales[0]?.partner?.currency || stores[0]?.partner?.currency || "EUR",
        kpis: {
          revenue,
          ordersCount,
          pendingCount,
          averageTicket,
          newCustomers,
          uniqueCustomers,
          activeStores,
          deliveryOrders,
          pickupOrders,
        },
        stores: [...storeMap.values()].sort((left, right) => {
          if (right.pending !== left.pending) return right.pending - left.pending;
          if (right.revenue !== left.revenue) return right.revenue - left.revenue;
          return left.storeName.localeCompare(right.storeName);
        }),
        topProducts,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[myorders.summary] error:", error);
      return res.status(500).json({ error: "Error building MyOrders summary" });
    }
  });

  router.patch("/:id/ready", async (req, res) => {
    const id = parsePositiveInt(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Valid order id required" });
    }

    try {
      const sale = await prisma.sale.findFirst({
        where: {
          id,
          status: { not: "CANCELED" },
        },
        select: { id: true },
      });

      if (!sale) {
        return res.status(404).json({ error: "Order not found" });
      }

      const updated = await prisma.sale.update({
        where: { id },
        data: { processed: true },
        include: {
          partner: { select: { id: true, name: true, currency: true } },
          store: { select: { id: true, storeName: true, slug: true, active: true } },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              address_1: true,
              portal: true,
              observations: true,
            },
          },
        },
      });

      return res.json({ ok: true, order: formatSale(updated) });
    } catch (error) {
      console.error("[myorders.ready] error:", error);
      return res.status(500).json({ error: "Error marking order ready" });
    }
  });

  return router;
}
