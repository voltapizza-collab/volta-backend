import express from "express";

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
  const parsed = parseMaybeJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

const cleanChatText = (value) => String(value || "").trim().replace(/\s+/g, " ");

const getChatMessages = (customerData) => {
  const data = asObject(customerData);
  const messages = Array.isArray(data.chatMessages) ? data.chatMessages : [];

  return messages
    .map((message) => ({
      id: String(message?.id || ""),
      sender: String(message?.sender || "").toUpperCase() === "CUSTOMER" ? "CUSTOMER" : "OPERATOR",
      text: cleanChatText(message?.text).slice(0, 600),
      createdAt: message?.createdAt || null,
      readAt: message?.readAt || null,
    }))
    .filter((message) => message.id && message.text);
};

const appendChatMessage = (customerData, message) => {
  const data = asObject(customerData);
  const messages = getChatMessages(data);

  return {
    ...data,
    chatMessages: [...messages, message].slice(-50),
    chatUpdatedAt: message.createdAt,
  };
};

const compareQueue = (left, right) => {
  if (left.boostActive !== right.boostActive) return left.boostActive ? -1 : 1;

  if (left.boostActive && right.boostActive) {
    const leftTarget = Number(left.boostTargetPosition || 999);
    const rightTarget = Number(right.boostTargetPosition || 999);
    if (leftTarget !== rightTarget) return leftTarget - rightTarget;

    const leftCredit = Number(left.boostQueueCredit || 0);
    const rightCredit = Number(right.boostQueueCredit || 0);
    if (leftCredit !== rightCredit) return rightCredit - leftCredit;
  }

  return new Date(left.date || left.createdAt).getTime() - new Date(right.date || right.createdAt).getTime();
};

const getStage = (sale) => {
  if (sale.status === "AWAITING_PAYMENT") return "AWAITING_PAYMENT";
  if (sale.status === "CANCELED") return "CANCELED";
  if (sale.processed) return "READY";
  return "PREPARING";
};

const getMessage = (sale, queuePosition) => {
  const stage = getStage(sale);

  if (stage === "AWAITING_PAYMENT") return "Estamos esperando la confirmacion del pago.";
  if (stage === "CANCELED") return "Este pedido aparece como cancelado.";
  if (stage === "READY") {
    return sale.delivery === "COURIER"
      ? "Tu pedido ya esta listo. La tienda esta gestionando la salida."
      : "Tu pedido esta listo para recoger.";
  }

  if (queuePosition > 1) return `Tu pedido esta en cocina. Ahora mismo va en la posicion ${queuePosition}.`;
  return "Tu pedido esta en cocina y va muy arriba en la cola.";
};

export default function salesRoutes(prisma) {
  const router = express.Router();

  router.get("/seguimiento/:code", async (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, message: "Codigo de pedido requerido" });

    try {
      const sale = await prisma.sale.findUnique({
        where: { code },
        include: {
          partner: { select: { id: true, name: true, slug: true, currency: true } },
          store: { select: { id: true, storeName: true, slug: true } },
          customer: { select: { name: true, phone: true } },
        },
      });

      if (!sale) {
        return res.status(404).json({ ok: false, message: "No encontramos ese pedido" });
      }

      const queueRows =
        sale.status === "PAID" && !sale.processed
          ? await prisma.sale.findMany({
              where: {
                storeId: sale.storeId,
                status: "PAID",
                processed: false,
              },
              select: {
                id: true,
                date: true,
                createdAt: true,
                boostActive: true,
                boostTargetPosition: true,
                boostQueueCredit: true,
              },
            })
          : [];
      const queuePosition = queueRows.sort(compareQueue).findIndex((row) => row.id === sale.id) + 1;
      const customerData = asObject(sale.customerData);
      const stage = getStage(sale);

      return res.json({
        ok: true,
        code: sale.code,
        stage,
        status: sale.status,
        processed: sale.processed,
        message: getMessage(sale, queuePosition),
        queuePosition: queuePosition || null,
        storeName: sale.store?.storeName || "",
        partnerName: sale.partner?.name || "",
        partnerSlug: sale.partner?.slug || "",
        storeSlug: sale.store?.slug || "",
        customerName: customerData.name || sale.customer?.name || "",
        chatMessages: getChatMessages(customerData),
        total: Number(sale.total || 0),
        currency: sale.currency || sale.partner?.currency || "EUR",
        delivery: sale.delivery,
        boost: {
          active: Boolean(sale.boostActive),
          targetPosition: sale.boostTargetPosition,
          originalPosition: sale.boostOriginalPosition,
          queueCredit: Number(sale.boostQueueCredit || 0),
          amount: sale.boostAmount == null ? 0 : Number(sale.boostAmount || 0),
          paidAt: sale.boostPaidAt,
          available: stage === "PREPARING" && !sale.boostActive,
        },
      });
    } catch (error) {
      console.error("[sales.tracking] error:", error);
      return res.status(500).json({ ok: false, message: "No se pudo obtener el estado del pedido" });
    }
  });

  router.post("/seguimiento/:code/messages", async (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    const text = cleanChatText(req.body?.text).slice(0, 600);

    if (!code) {
      return res.status(400).json({ ok: false, message: "Codigo de pedido requerido" });
    }

    if (text.length < 2) {
      return res.status(400).json({ ok: false, message: "Escribe una respuesta." });
    }

    try {
      const sale = await prisma.sale.findUnique({
        where: { code },
        select: { id: true, code: true, status: true, customerData: true },
      });

      if (!sale || sale.status === "CANCELED") {
        return res.status(404).json({ ok: false, message: "No encontramos ese pedido" });
      }

      const message = {
        id: `cu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sender: "CUSTOMER",
        text,
        createdAt: new Date().toISOString(),
        readAt: null,
      };
      const customerData = appendChatMessage(sale.customerData, message);

      await prisma.sale.update({
        where: { id: sale.id },
        data: { customerData },
      });

      return res.json({
        ok: true,
        message,
        messages: getChatMessages(customerData),
      });
    } catch (error) {
      console.error("[sales.tracking.messages] error:", error);
      return res.status(500).json({ ok: false, message: "No se pudo enviar la respuesta" });
    }
  });

  return router;
}
