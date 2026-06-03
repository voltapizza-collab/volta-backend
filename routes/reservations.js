import express from "express";
import { normalizeE164Phone, sendTelnyxSms } from "../services/telnyx.js";
import { sendReservationCanceledTrackingSms } from "../services/trackingNotifications.js";

const TZ = process.env.TIMEZONE || "Europe/Madrid";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseDateOnly = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const minutesToHHMM = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const hhmmToMinutes = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
};

const roundUpToStep = (minutes, step) => Math.ceil(minutes / step) * step;

const isSameLocalDay = (left, right) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const dayBounds = (date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

const nowInTZ = () => {
  const snapshot = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  return new Date(snapshot.replace(" ", "T"));
};

const normalizeStatus = (status) => {
  switch (String(status || "").trim().toLowerCase()) {
    case "complete":
    case "completed":
      return "COMPLETED";
    case "cancel":
    case "cancelled":
    case "canceled":
      return "CANCELED";
    case "confirm":
    case "confirmed":
      return "CONFIRMED";
    default:
      return "PENDING";
  }
};

const serializeReservation = (reservation) => ({
  ...reservation,
  status: String(reservation.status || "").toLowerCase(),
});

const cleanDigits = (value) => String(value || "").replace(/\D/g, "");

const phoneBase9 = (value) => {
  const digits = cleanDigits(value);
  if (digits.length === 9) return digits;
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  if (digits.length > 9) return digits.slice(-9);
  return null;
};

const publicFrontendBaseUrl = () =>
  (
    process.env.FRONT_BASE_URL ||
    process.env.PUBLIC_FRONTEND_URL ||
    process.env.STOREFRONT_URL ||
    process.env.FRONTEND_URL ||
    "https://voltapizza.com"
  ).replace(/\/$/, "");

const formatDateES = (date) => {
  try {
    return new Date(date).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
};

const buildReservationSms = ({
  customerName,
  reservationDate,
  reservationTime,
  partySize,
  storeName,
  storeAddress,
  partnerName,
  cancelLink,
}) => {
  const date = formatDateES(reservationDate);
  const place = [storeName, storeAddress].filter(Boolean).join(" - ");
  const brand = String(partnerName || process.env.TELNYX_SMS_BRAND || "VoltaPizza").replace(/\s+/g, " ").trim();

  return `${brand}: hola ${customerName || ""}

Tu reserva esta confirmada.

Fecha: ${date}
Hora: ${reservationTime}
Personas: ${partySize}
Lugar: ${place || "Tienda seleccionada"}

Si necesitas cancelar:
${cancelLink}

Te esperamos.`;
};

async function genCustomerCode(prisma) {
  let code;
  do {
    code = `CUS-${Math.floor(10000 + Math.random() * 90000)}`;
  } while (await prisma.customer.findUnique({ where: { code } }));
  return code;
}

async function upsertReservationCustomer(tx, { partnerId, customerName, customerPhone }) {
  const normalizedPhone = normalizeE164Phone(customerPhone);
  const base9 = phoneBase9(customerPhone);

  if (!normalizedPhone || !base9) return null;

  const existing = await tx.customer.findFirst({
    where: {
      partnerId,
      phone: { contains: base9 },
    },
  });

  if (existing) {
    return tx.customer.update({
      where: { id: existing.id },
      data: {
        name: customerName || existing.name,
        phone: normalizedPhone,
      },
    });
  }

  return tx.customer.create({
    data: {
      partnerId,
      code: await genCustomerCode(tx),
      origin: "PHONE",
      name: customerName,
      phone: normalizedPhone,
      address_1: `(RESERVA) ${normalizedPhone}`,
    },
  });
}

export default function reservationsRoutes(prisma) {
  const router = express.Router();

  router.get("/availability", async (req, res) => {
    const storeId = parsePositiveInt(req.query.storeId);
    const date = parseDateOnly(req.query.date);
    const partySize = parsePositiveInt(req.query.partySize) || 1;

    if (!storeId || !date) {
      return res.status(400).json({ error: "storeId and date required" });
    }

    try {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          acceptsReservations: true,
          reservationCapacity: true,
        },
      });

      if (!store) return res.status(404).json({ error: "store not found" });

      const capacity = store.acceptsReservations ? store.reservationCapacity || 0 : 0;
      if (capacity <= 0) {
        return res.json({ capacity, availability: [] });
      }

      const storeHours = await prisma.storeHours.findMany({
        where: {
          storeId,
          dayOfWeek: date.getDay(),
        },
        orderBy: { openTime: "asc" },
      });

      if (!storeHours.length) {
        return res.json({ capacity, availability: [] });
      }

      const now = nowInTZ();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const isToday = isSameLocalDay(date, now);
      const step = 30;
      const slots = [];

      storeHours.forEach((hours) => {
        const windowStart = Number(hours.openTime) + 30;
        const windowEnd = Number(hours.closeTime) - 60;
        const earliest = isToday ? Math.max(windowStart, nowMinutes + 1) : windowStart;
        const start = roundUpToStep(earliest, step);

        for (let minute = start; minute <= windowEnd; minute += step) {
          slots.push(minutesToHHMM(minute));
        }
      });

      const { start, end } = dayBounds(date);
      const reservations = await prisma.reservation.findMany({
        where: {
          storeId,
          status: { in: ["PENDING", "CONFIRMED"] },
          reservationDate: {
            gte: start,
            lt: end,
          },
        },
        select: {
          reservationTime: true,
          partySize: true,
        },
      });

      const occupiedByTime = reservations.reduce((acc, reservation) => {
        acc[reservation.reservationTime] =
          (acc[reservation.reservationTime] || 0) + reservation.partySize;
        return acc;
      }, {});

      const availability = [...new Set(slots)].sort().map((time) => {
        const occupied = occupiedByTime[time] || 0;
        const available = capacity - occupied;

        return {
          time,
          occupied,
          available,
          canFit: available >= partySize,
        };
      });

      return res.json({ capacity, availability });
    } catch (error) {
      console.error("[GET /reservations/availability]", error);
      return res.status(500).json({ error: "internal error" });
    }
  });

  router.post("/", async (req, res) => {
    const storeId = parsePositiveInt(req.body.storeId);
    const customerName = String(req.body.customerName || "").trim();
    const customerPhone = String(req.body.customerPhone || "").trim();
    const partySize = parsePositiveInt(req.body.partySize);
    const reservationDate = parseDateOnly(req.body.reservationDate);
    const reservationTime = String(req.body.reservationTime || "").trim();
    const timeMinutes = hhmmToMinutes(reservationTime);

    if (!storeId || !customerName || !partySize || !reservationDate || timeMinutes == null) {
      return res.status(400).json({ error: "missing fields" });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: storeId },
          select: {
            id: true,
            partnerId: true,
            storeName: true,
            address: true,
            city: true,
            acceptsReservations: true,
            reservationCapacity: true,
            partner: {
              select: {
                name: true,
              },
            },
          },
        });

        if (!store || !store.acceptsReservations) {
          throw new Error("store not available for reservations");
        }

        const capacity = store.reservationCapacity || 0;
        if (capacity <= 0) throw new Error("no capacity");

        const hours = await tx.storeHours.findFirst({
          where: {
            storeId,
            dayOfWeek: reservationDate.getDay(),
            openTime: { lte: timeMinutes - 30 },
            closeTime: { gte: timeMinutes + 60 },
          },
        });

        if (!hours) throw new Error("time outside store hours");

        const now = nowInTZ();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        if (isSameLocalDay(reservationDate, now) && timeMinutes <= nowMinutes) {
          throw new Error("reservation time already passed");
        }

        const reservationDateTime = new Date(reservationDate);
        reservationDateTime.setHours(
          Math.floor(timeMinutes / 60),
          timeMinutes % 60,
          0,
          0
        );

        if (reservationDateTime.getTime() < now.getTime()) {
          throw new Error("reservation time has passed");
        }

        const { start, end } = dayBounds(reservationDate);
        const existing = await tx.reservation.findMany({
          where: {
            storeId,
            reservationTime,
            status: { in: ["PENDING", "CONFIRMED"] },
            reservationDate: {
              gte: start,
              lt: end,
            },
          },
          select: { partySize: true },
        });

        const occupied = existing.reduce((sum, row) => sum + row.partySize, 0);
        if (capacity - occupied < partySize) {
          throw new Error("no capacity");
        }

        await upsertReservationCustomer(tx, {
          partnerId: store.partnerId,
          customerName,
          customerPhone,
        });

        const reservation = await tx.reservation.create({
          data: {
            storeId,
            partnerId: store.partnerId,
            customerName,
            customerPhone: customerPhone || null,
            partySize,
            reservationDate,
            reservationTime,
            reservationDateTime,
            status: "PENDING",
          },
        });

        return { reservation, store };
      });

      let sms = null;
      const reservation = result.reservation;
      const storeInfo = result.store;

      if (customerPhone) {
        const cancelLink = `${publicFrontendBaseUrl()}/reservation/${reservation.id}/cancel`;
        sms = await sendTelnyxSms({
          to: customerPhone,
          text: buildReservationSms({
            customerName,
            reservationDate,
            reservationTime,
            partySize,
            storeName: storeInfo.storeName,
            storeAddress: [storeInfo.address, storeInfo.city].filter(Boolean).join(", "),
            partnerName: storeInfo.partner?.name,
            cancelLink,
          }),
          tags: [`reservation:${reservation.id}`, `store:${storeId}`],
        });
      }

      return res.json({
        ...serializeReservation(reservation),
        sms,
      });
    } catch (error) {
      console.error("[POST /reservations]", error);
      return res.status(400).json({ error: error.message || "internal error" });
    }
  });

  router.get("/store/:storeId", async (req, res) => {
    const storeId = parsePositiveInt(req.params.storeId);
    if (!storeId) return res.status(400).json({ error: "Invalid storeId" });

    try {
      const rows = await prisma.reservation.findMany({
        where: { storeId },
        orderBy: { reservationDateTime: "asc" },
      });

      return res.json(rows.map(serializeReservation));
    } catch (error) {
      console.error("[GET /reservations/store/:storeId]", error);
      return res.status(500).json({ error: "internal error" });
    }
  });

  router.get("/today/:storeId", async (req, res) => {
    const storeId = parsePositiveInt(req.params.storeId);
    if (!storeId) return res.status(400).json({ error: "Invalid storeId" });

    try {
      const { start, end } = dayBounds(new Date());
      const rows = await prisma.reservation.findMany({
        where: {
          storeId,
          status: { in: ["PENDING", "CONFIRMED"] },
          reservationDate: {
            gte: start,
            lt: end,
          },
        },
        orderBy: { reservationTime: "asc" },
      });

      return res.json(rows.map(serializeReservation));
    } catch (error) {
      console.error("[GET /reservations/today/:storeId]", error);
      return res.status(500).json({ error: "internal error" });
    }
  });

  router.patch("/:id/:status", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid reservation id" });

    try {
      const nextStatus = normalizeStatus(req.params.status);
      const previous = await prisma.reservation.findUnique({
        where: { id },
        select: { status: true },
      });

      const updated = await prisma.reservation.update({
        where: { id },
        data: { status: nextStatus },
        include: {
          store: {
            select: {
              id: true,
              partnerId: true,
              storeName: true,
              partner: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      let notification = null;
      if (nextStatus === "CANCELED" && previous?.status !== "CANCELED") {
        if (updated.partnerId) {
          const partnerRows = await prisma.$queryRawUnsafe(
            "SELECT trackingNotificationSettings FROM Partner WHERE id = ?",
            updated.partnerId
          );
          updated.store.partner = {
            ...(updated.store.partner || {}),
            trackingNotificationSettings:
              partnerRows?.[0]?.trackingNotificationSettings || null,
          };
        }

        try {
          notification = await sendReservationCanceledTrackingSms(prisma, {
            reservation: updated,
          });
        } catch (notificationError) {
          console.error(
            "[PATCH /reservations/:id/:status notification]",
            notificationError
          );
          notification = {
            ok: false,
            skipped: true,
            reason: "notification_failed",
          };
        }
      }

      return res.json({
        ...serializeReservation(updated),
        notification,
      });
    } catch (error) {
      console.error("[PATCH /reservations/:id/:status]", error);
      return res.status(500).json({ error: "internal error" });
    }
  });

  return router;
}
