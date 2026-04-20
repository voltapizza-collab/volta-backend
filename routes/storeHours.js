import express from "express";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export default function storeHoursRoutes(prisma) {
  const router = express.Router();

  router.get("/:storeId", async (req, res) => {
    const storeId = parsePositiveInt(req.params.storeId);
    if (!storeId) {
      return res.status(400).json({ error: "Invalid storeId" });
    }

    try {
      const rows = await prisma.storeHours.findMany({
        where: { storeId },
        orderBy: [{ dayOfWeek: "asc" }, { openTime: "asc" }],
      });

      return res.json(rows);
    } catch (error) {
      console.error("[GET /store-hours/:storeId]", error);
      return res.status(500).json({ error: "Failed to load hours" });
    }
  });

  router.post("/", async (req, res) => {
    const storeId = parsePositiveInt(req.body.storeId);
    const dayOfWeek = Number(req.body.dayOfWeek);
    const openTime = Number(req.body.openTime);
    const closeTime = Number(req.body.closeTime);

    if (
      !storeId ||
      !Number.isInteger(dayOfWeek) ||
      !Number.isInteger(openTime) ||
      !Number.isInteger(closeTime)
    ) {
      return res.status(400).json({ error: "Invalid slot payload" });
    }

    try {
      const row = await prisma.storeHours.create({
        data: {
          storeId,
          dayOfWeek,
          openTime,
          closeTime,
        },
      });

      return res.json(row);
    } catch (error) {
      console.error("[POST /store-hours]", error);
      return res.status(500).json({ error: "Failed to create slot" });
    }
  });

  router.patch("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const data = {};

    if (req.body.openTime !== undefined) {
      data.openTime = Number(req.body.openTime);
    }

    if (req.body.closeTime !== undefined) {
      data.closeTime = Number(req.body.closeTime);
    }

    try {
      const row = await prisma.storeHours.update({
        where: { id },
        data,
      });

      return res.json(row);
    } catch (error) {
      console.error("[PATCH /store-hours/:id]", error);
      return res.status(500).json({ error: "Failed to update slot" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid id" });
    }

    try {
      await prisma.storeHours.delete({
        where: { id },
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("[DELETE /store-hours/:id]", error);
      return res.status(500).json({ error: "Failed to delete slot" });
    }
  });

  return router;
}
