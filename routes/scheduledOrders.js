import express from "express";
import { normalizeE164Phone, sendTelnyxSms } from "../services/telnyx.js";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const cleanDigits = (value) => String(value || "").replace(/\D/g, "");

const phoneBase9 = (value) => {
  const digits = cleanDigits(value);
  if (digits.length === 9) return digits;
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  if (digits.length > 9) return digits.slice(-9);
  return null;
};

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

const formatTimeES = (date) => {
  try {
    return new Date(date).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const formatMoney = (value, currency = "EUR") =>
  `${currency} ${Number(value || 0).toFixed(2)}`;

async function genCustomerCode(prisma) {
  let code;
  do {
    code = `CUS-${Math.floor(10000 + Math.random() * 90000)}`;
  } while (await prisma.customer.findUnique({ where: { code } }));
  return code;
}

async function upsertScheduledOrderCustomer(tx, { partnerId, customerName, customerPhone }) {
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
      address_1: `(PEDIDO PROGRAMADO) ${normalizedPhone}`,
    },
  });
}

const buildScheduledOrderSms = ({
  customerName,
  scheduledFor,
  total,
  currency,
  storeName,
  storeAddress,
  partnerName,
}) => {
  const place = [storeName, storeAddress].filter(Boolean).join(" - ");

  return `Hola ${customerName || ""}

Tu pedido programado esta confirmado.

Fecha: ${formatDateES(scheduledFor)}
Hora: ${formatTimeES(scheduledFor)}
Lugar: ${place || "Tienda seleccionada"}
Total: ${formatMoney(total, currency)}

Te esperamos en ${partnerName || "VoltaPizza"}`;
};

export default function scheduledOrdersRoutes(prisma) {
  const router = express.Router();

  router.post("/confirm", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    const storeId = parsePositiveInt(req.body.storeId);
    const customerName = String(req.body.customerName || "").trim();
    const customerPhone = String(req.body.customerPhone || "").trim();
    const scheduledFor = new Date(req.body.scheduledFor || "");
    const total = Number(req.body.total || 0);
    const currency = String(req.body.currency || "EUR").trim().toUpperCase();

    if (
      !partnerId ||
      !storeId ||
      !customerName ||
      !customerPhone ||
      Number.isNaN(scheduledFor.getTime())
    ) {
      return res.status(400).json({ error: "missing fields" });
    }

    if (scheduledFor.getTime() < Date.now()) {
      return res.status(400).json({ error: "scheduled time has passed" });
    }

    try {
      const { store, customer } = await prisma.$transaction(async (tx) => {
        const store = await tx.store.findFirst({
          where: {
            id: storeId,
            partnerId,
          },
          select: {
            id: true,
            storeName: true,
            address: true,
            city: true,
            partner: {
              select: {
                name: true,
              },
            },
          },
        });

        if (!store) throw new Error("store not found");

        const customer = await upsertScheduledOrderCustomer(tx, {
          partnerId,
          customerName,
          customerPhone,
        });

        return { store, customer };
      });

      const sms = await sendTelnyxSms({
        to: customerPhone,
        text: buildScheduledOrderSms({
          customerName,
          scheduledFor,
          total,
          currency,
          storeName: store.storeName,
          storeAddress: [store.address, store.city].filter(Boolean).join(", "),
          partnerName: store.partner?.name,
        }),
        tags: [`scheduled-order:${storeId}`],
      });

      return res.json({
        ok: true,
        customerId: customer?.id || null,
        sms,
      });
    } catch (error) {
      console.error("[POST /scheduled-orders/confirm]", error);
      return res.status(400).json({ error: error.message || "internal error" });
    }
  });

  return router;
}
