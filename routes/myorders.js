import express from "express";

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

const orderScopeWhere = ({ partnerId, storeId, activeStoresOnly = true }) => ({
  ...(partnerId ? { partnerId } : {}),
  ...(storeId ? { storeId } : {}),
  ...(activeStoresOnly ? { store: { active: true } } : {}),
});

export default function myordersRoutes(prisma) {
  const router = express.Router();

  router.get("/pending", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    const storeId = parsePositiveInt(req.query.storeId);
    const since = parseOptionalDate(req.query.since);
    const take = Math.min(parsePositiveInt(req.query.take) || 80, 200);

    try {
      const rows = await prisma.sale.findMany({
        where: {
          ...orderScopeWhere({ partnerId, storeId }),
          processed: false,
          status: { in: ["PENDING", "PAID"] },
          ...(since
            ? {
                OR: [
                  { date: { gt: since } },
                  { createdAt: { gt: since } },
                ],
              }
            : {}),
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
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        take,
      });

      return res.json({
        items: rows.map(formatSale),
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
          where: {
            ...scope,
            processed: false,
            status: { in: ["PENDING", "PAID"] },
          },
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
        where: {
          ...scope,
          processed: false,
          status: { in: ["PENDING", "PAID"] },
        },
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
