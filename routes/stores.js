import express from "express";

const TZ = process.env.TIMEZONE || "Europe/Madrid";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toNullableFloat = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toNullableInt = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildStorePayload = (body) => {
  const acceptsReservations = Boolean(body.acceptsReservations);
  const reservationCapacity = acceptsReservations
    ? toNullableInt(body.reservationCapacity) ?? 0
    : null;

  return {
    storeName: String(body.storeName || body.name || "").trim(),
    slug: slugify(body.slug || body.storeName || body.name),
    address: String(body.address || "").trim(),
    city: body.city ? String(body.city).trim() : null,
    zipCode: body.zipCode ? String(body.zipCode).trim() : null,
    email: body.email ? String(body.email).trim() : null,
    tlf: body.tlf ? String(body.tlf).trim() : null,
    latitude: toNullableFloat(body.latitude),
    longitude: toNullableFloat(body.longitude),
    active: typeof body.active === "boolean" ? body.active : true,
    acceptingOrders:
      typeof body.acceptingOrders === "boolean" ? body.acceptingOrders : true,
    acceptsReservations,
    reservationCapacity,
  };
};

const zeroStockForNewStore = async (tx, storeId, partnerId) => {
  const pizzas = await tx.menuPizza.findMany({
    where: { partnerId },
    select: { id: true },
  });

  if (!pizzas.length) return;

  await tx.storePizzaStock.createMany({
    data: pizzas.map((pizza) => ({
      storeId,
      pizzaId: pizza.id,
      stock: 0,
      active: true,
    })),
    skipDuplicates: true,
  });
};

const dayLabels = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miercoles",
  "Jueves",
  "Viernes",
  "Sabado",
];

const normalizePromoDaysActive = (value) => {
  if (!value) return [];
  let list = value;

  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = value.split(",");
    }
  }

  if (!Array.isArray(list)) return [];

  return [...new Set(
    list
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
  )].sort();
};

const minutesOfDay = (date) => date.getHours() * 60 + date.getMinutes();

const nowInTZ = () => {
  const snapshot = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  return new Date(snapshot.replace(" ", "T"));
};

const isPromoWithinWindow = (promo, reference) => {
  const days = normalizePromoDaysActive(promo.daysActive);
  if (!days.length && promo.windowStart == null && promo.windowEnd == null) return true;

  if (days.length && !days.includes(reference.getDay())) return false;

  const start = promo.windowStart == null ? 0 : Number(promo.windowStart);
  const end = promo.windowEnd == null ? 24 * 60 : Number(promo.windowEnd);
  const minutes = minutesOfDay(reference);

  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
};

const attachStorePublicMenu = (router, prisma) => {
  router.get("/:partnerSlug/:storeSlug/menu", async (req, res) => {
    try {
      const { partnerSlug, storeSlug } = req.params;

      const partner = await prisma.partner.findUnique({
        where: { slug: partnerSlug },
      });

      if (!partner) {
        return res.status(404).json({ error: "Partner not found" });
      }

      const store = await prisma.store.findFirst({
        where: {
          slug: storeSlug,
          partnerId: partner.id,
        },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      const pizzas = await prisma.menuPizza.findMany({
        where: {
          partnerId: store.partnerId,
          status: "ACTIVE",
          type: "SELLABLE",
        },
        select: {
          id: true,
          name: true,
          category: true,
          categoryId: true,
          selectSize: true,
          priceBySize: true,
          image: true,
          launchAt: true,
          stocks: {
            where: { storeId: store.id },
            select: {
              active: true,
              stock: true,
            },
          },
          ingredients: {
            select: {
              qtyBySize: true,
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  storeStocks: {
                    where: { storeId: store.id },
                    select: { active: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { id: "asc" },
      });

      const availablePizzas = pizzas.filter((pizza) => {
        const storePizzaState = pizza.stocks?.[0];

        if (!storePizzaState || storePizzaState.active !== true) {
          return false;
        }

        return (pizza.ingredients || []).every((rel) => {
          const ingredient = rel.ingredient;
          const storeStock = ingredient?.storeStocks?.[0];
          return ingredient?.status === "ACTIVE" && storeStock?.active === true;
        });
      });

      const now = new Date();
      const mapPublicPizza = (pizza, available) => ({
        pizzaId: pizza.id,
        name: pizza.name,
        categoryId: pizza.categoryId ?? null,
        category: pizza.category ?? null,
        selectSize: pizza.selectSize ?? [],
        priceBySize: pizza.priceBySize ?? {},
        image: pizza.image ?? null,
        launchAt: pizza.launchAt ?? null,
        stock: pizza.stocks?.[0]?.stock ?? null,
        ingredients: (pizza.ingredients || []).map((rel) => ({
          id: rel.ingredient.id,
          name: rel.ingredient.name,
          qtyBySize: rel.qtyBySize ?? {},
        })),
        extras: [],
        available,
      });
      const menu = availablePizzas
        .filter((pizza) => !pizza.launchAt || pizza.launchAt <= now)
        .map((pizza) => mapPublicPizza(pizza, true));
      const upcoming = availablePizzas
        .filter((pizza) => pizza.launchAt && pizza.launchAt > now)
        .map((pizza) => mapPublicPizza(pizza, false));
      const promos = await prisma.promo.findMany({
        where: {
          partnerId: store.partnerId,
          status: "ACTIVE",
          AND: [
            {
              OR: [
                { activeFrom: null },
                { activeFrom: { lte: now } },
              ],
            },
            {
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: now } },
              ],
            },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
      const promoWindowNow = nowInTZ();
      const visiblePromos = promos.filter((promo) =>
        isPromoWithinWindow(promo, promoWindowNow)
      );

      return res.json({
        store: {
          id: store.id,
          storeName: store.storeName,
          slug: store.slug,
          city: store.city,
          tlf: store.tlf,
          acceptsReservations: store.acceptsReservations,
        },
        menu,
        upcoming,
        promos: visiblePromos.map((promo) => ({
          id: promo.id,
          title: promo.title,
          description: promo.description,
          items: Array.isArray(promo.items) ? promo.items : [],
          totalPrice: Number(promo.totalPrice || 0),
          activeFrom: promo.activeFrom,
          expiresAt: promo.expiresAt,
          daysActive: normalizePromoDaysActive(promo.daysActive),
          windowStart: promo.windowStart,
          windowEnd: promo.windowEnd,
          image: promo.image,
        })),
      });
    } catch (error) {
      console.error("GET /stores/:partnerSlug/:storeSlug/menu", error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.get("/:partnerSlug/:storeSlug", async (req, res) => {
    try {
      const { partnerSlug, storeSlug } = req.params;

      const partner = await prisma.partner.findUnique({
        where: { slug: partnerSlug },
      });

      if (!partner) {
        return res.status(404).json({ error: "Partner not found" });
      }

      const store = await prisma.store.findFirst({
        where: {
          slug: storeSlug,
          partnerId: partner.id,
        },
        include: {
          partner: true,
          hours: {
            orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
          },
        },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      return res.json(store);
    } catch (error) {
      console.error("GET /stores/:partnerSlug/:storeSlug", error);
      return res.status(500).json({ error: error.message });
    }
  });
};

export default function storesRoutes(prisma) {
  const router = express.Router();

  router.patch("/:id/active", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    const { active } = req.body;
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "body.active boolean required" });
    }

    try {
      const updated = await prisma.store.update({
        where: { id },
        data: { active },
      });

      return res.json({ ok: true, active: updated.active });
    } catch (error) {
      console.error("[PATCH /stores/:id/active]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  router.get("/nearest", async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const partnerId = req.query.partnerId
      ? parsePositiveInt(req.query.partnerId)
      : null;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "coords requeridas" });
    }

    try {
      const stores = await prisma.store.findMany({
        where: {
          active: true,
          ...(partnerId ? { partnerId } : {}),
        },
      });

      const toRad = (value) => (value * Math.PI) / 180;
      const haversineKm = (from, to) => {
        const dLat = toRad(to.lat - from.lat);
        const dLng = toRad(to.lng - from.lng);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(from.lat)) *
            Math.cos(toRad(to.lat)) *
            Math.sin(dLng / 2) ** 2;
        return 2 * 6371 * Math.asin(Math.sqrt(a));
      };

      let best = null;

      stores.forEach((store) => {
        if (store.latitude == null || store.longitude == null) return;

        const distanceKm = haversineKm(
          { lat, lng },
          { lat: store.latitude, lng: store.longitude }
        );

        if (!best || distanceKm < best.distanceKm) {
          best = { store, distanceKm };
        }
      });

      if (!best) {
        return res.status(404).json({ error: "no stores with coords" });
      }

      return res.json({
        storeId: best.store.id,
        storeName: best.store.storeName,
        slug: best.store.slug,
        distanciaKm: Number(best.distanceKm.toFixed(2)),
      });
    } catch (error) {
      console.error("[GET /stores/nearest]", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.get("/reservations-enabled", async (req, res) => {
    try {
      const partnerId = req.query.partnerId
        ? parsePositiveInt(req.query.partnerId)
        : null;

      const stores = await prisma.store.findMany({
        where: {
          acceptsReservations: true,
          active: true,
          ...(partnerId ? { partnerId } : {}),
        },
        select: {
          id: true,
          partnerId: true,
          slug: true,
          storeName: true,
          reservationCapacity: true,
        },
        orderBy: { storeName: "asc" },
      });

      return res.json(stores);
    } catch (error) {
      console.error("[GET /stores/reservations-enabled]", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  router.get("/:id/report", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    try {
      const store = await prisma.store.findUnique({
        where: { id },
        select: {
          id: true,
          storeName: true,
          partnerId: true,
          partner: {
            select: {
              currency: true,
            },
          },
        },
      });

      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      const sales = await prisma.sale.findMany({
        where: {
          storeId: id,
          status: { not: "CANCELED" },
        },
        select: {
          id: true,
          total: true,
          date: true,
          createdAt: true,
          channel: true,
          delivery: true,
        },
        orderBy: { date: "desc" },
      });

      const safeSales = sales.filter((sale) => Number.isFinite(Number(sale.total)));
      const totalSales = safeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
      const ordersCount = safeSales.length;
      const averageTicket = ordersCount ? totalSales / ordersCount : 0;

      const hourBuckets = new Map();
      const dayBuckets = new Map();
      const channelBuckets = new Map();

      safeSales.forEach((sale) => {
        const date = sale.date || sale.createdAt;
        const current = new Date(date);
        const hour = current.getHours();
        const day = current.getDay();

        hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
        dayBuckets.set(day, (dayBuckets.get(day) || 0) + Number(sale.total || 0));
        channelBuckets.set(sale.channel, (channelBuckets.get(sale.channel) || 0) + 1);
      });

      const bestHourEntry = [...hourBuckets.entries()].sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0] - right[0];
      })[0];

      const bestDayEntry = [...dayBuckets.entries()].sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0] - right[0];
      })[0];

      const bestChannelEntry = [...channelBuckets.entries()].sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return String(left[0] || "").localeCompare(String(right[0] || ""));
      })[0];

      return res.json({
        storeId: store.id,
        storeName: store.storeName,
        currency: store.partner?.currency || "EUR",
        periodLabel: ordersCount ? "Historico actual" : "Sin ventas todavia",
        kpis: {
          totalSales,
          ordersCount,
          averageTicket,
          bestHour: bestHourEntry
            ? `${String(bestHourEntry[0]).padStart(2, "0")}:00`
            : null,
          bestHourOrders: bestHourEntry?.[1] || 0,
          bestDay: bestDayEntry ? dayLabels[bestDayEntry[0]] : null,
          bestDaySales: bestDayEntry?.[1] || 0,
          topChannel: bestChannelEntry?.[0] || null,
          topChannelCount: bestChannelEntry?.[1] || 0,
        },
        lastSaleAt: safeSales[0]?.date || safeSales[0]?.createdAt || null,
      });
    } catch (error) {
      console.error("[GET /stores/:id/report]", error);
      return res.status(500).json({ error: "Error building store report" });
    }
  });

  router.get("/:id", async (req, res, next) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return next();

    try {
      const store = await prisma.store.findUnique({
        where: { id },
        include: {
          partner: true,
          hours: {
            orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
          },
        },
      });

      if (!store) {
        return res.status(404).json({ error: "not found" });
      }

      return res.json(store);
    } catch (error) {
      console.error("[GET /stores/:id]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  router.get("/", async (req, res) => {
    try {
      const partnerId = req.query.partnerId
        ? parsePositiveInt(req.query.partnerId)
        : null;

      const stores = await prisma.store.findMany({
        where: partnerId ? { partnerId } : undefined,
        orderBy: [{ partnerId: "asc" }, { id: "desc" }],
      });

      return res.json(stores);
    } catch (error) {
      console.error("[GET /stores]", error);
      return res.status(500).json({ error: "Error fetching stores" });
    }
  });

  router.post("/", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    if (!partnerId) {
      return res.status(400).json({ error: "Valid partnerId required" });
    }

    const payload = buildStorePayload(req.body);

    if (!payload.storeName) {
      return res.status(400).json({ error: "storeName required" });
    }

    if (!payload.slug) {
      return res.status(400).json({ error: "slug required" });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const partner = await tx.partner.findUnique({
          where: { id: partnerId },
          select: { id: true },
        });

        if (!partner) {
          throw new Error("Partner not found");
        }

        const store = await tx.store.create({
          data: {
            partnerId,
            ...payload,
          },
        });

        await zeroStockForNewStore(tx, store.id, partnerId);

        const ingredients = await tx.ingredient.findMany({
          select: { id: true },
        });

        if (ingredients.length) {
          await tx.storeIngredientStock.createMany({
            data: ingredients.map((ingredient) => ({
              storeId: store.id,
              ingredientId: ingredient.id,
              stock: 0,
              active: true,
            })),
            skipDuplicates: true,
          });
        }

        return store;
      });

      return res.json(result);
    } catch (error) {
      console.error("[POST /stores]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  router.patch("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    const payload = buildStorePayload(req.body);

    try {
      const existing = await prisma.store.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({ error: "Store not found" });
      }

      const updated = await prisma.store.update({
        where: { id },
        data: {
          storeName: payload.storeName || existing.storeName,
          slug: payload.slug || existing.slug,
          address: payload.address || existing.address,
          city: payload.city,
          zipCode: payload.zipCode,
          email: payload.email,
          tlf: payload.tlf,
          latitude: payload.latitude,
          longitude: payload.longitude,
          active:
            typeof req.body.active === "boolean" ? payload.active : existing.active,
          acceptingOrders:
            typeof req.body.acceptingOrders === "boolean"
              ? payload.acceptingOrders
              : existing.acceptingOrders,
          acceptsReservations: payload.acceptsReservations,
          reservationCapacity: payload.reservationCapacity,
        },
      });

      return res.json(updated);
    } catch (error) {
      console.error("[PATCH /stores/:id]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Valid id required" });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.storePizzaStock.deleteMany({ where: { storeId: id } });
        await tx.storeIngredientStock.deleteMany({ where: { storeId: id } });
        await tx.storeHours.deleteMany({ where: { storeId: id } });
        await tx.reservation.deleteMany({ where: { storeId: id } });
        await tx.sale.deleteMany({ where: { storeId: id } });
        await tx.store.delete({ where: { id } });
      });

      return res.json({ ok: true, id });
    } catch (error) {
      console.error("[DELETE /stores/:id]", error);
      return res.status(400).json({ error: error.message });
    }
  });

  attachStorePublicMenu(router, prisma);

  return router;
}
