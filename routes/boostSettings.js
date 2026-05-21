import express from "express";
import { getBoostSettings, MIN_BOOST_UNIT_PRICE, normalizeBoostSettings } from "../services/boostSettings.js";

const parseNumber = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function boostSettingsRoutes(prisma) {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const settings = await getBoostSettings(prisma);
      return res.json(settings);
    } catch (error) {
      console.error("[boost-settings.get] error:", error);
      return res.status(500).json({ error: "Error fetching Boost settings" });
    }
  });

  router.patch("/", async (req, res) => {
    try {
      const unitPrice = parseNumber(req.body?.unitPrice);
      const maxOptions = parseNumber(req.body?.maxOptions);
      const voltaSharePercent = parseNumber(req.body?.voltaSharePercent);
      const active =
        typeof req.body?.active === "boolean" ? req.body.active : undefined;

      if (unitPrice == null || unitPrice < MIN_BOOST_UNIT_PRICE) {
        return res.status(400).json({ error: `unitPrice must be at least ${MIN_BOOST_UNIT_PRICE}` });
      }

      if (!Number.isInteger(maxOptions) || maxOptions <= 0) {
        return res.status(400).json({ error: "maxOptions must be a positive integer" });
      }

      if (
        voltaSharePercent == null ||
        voltaSharePercent < 0 ||
        voltaSharePercent > 100
      ) {
        return res.status(400).json({ error: "voltaSharePercent must be between 0 and 100" });
      }

      const updated = await prisma.boostSetting.upsert({
        where: { id: 1 },
        update: {
          active,
          unitPrice,
          maxOptions,
          voltaSharePercent,
        },
        create: {
          id: 1,
          active: active ?? true,
          unitPrice,
          maxOptions,
          voltaSharePercent,
        },
      });

      return res.json(normalizeBoostSettings(updated));
    } catch (error) {
      console.error("[boost-settings.patch] error:", error);
      return res.status(500).json({ error: "Error saving Boost settings" });
    }
  });

  return router;
}
