import express from "express";
import { buildBackofficeNotifications } from "../services/backofficeNotifications.js";

export default function backofficeNotificationsRoutes(prisma) {
  const router = express.Router();
  router.get("/:partnerId", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const partnerId = Number(req.params.partnerId);
    if (!/^\d+$/.test(req.params.partnerId) || !Number.isSafeInteger(partnerId) || partnerId <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_partner_id" });
    }
    try {
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
        select: { id: true, smsCredits: true, smsLowBalanceThreshold: true },
      });
      if (!partner) return res.status(404).json({ ok: false, error: "partner_not_found" });
      const checkedAt = new Date();
      return res.json({
        ok: true,
        checkedAt: checkedAt.toISOString(),
        notifications: buildBackofficeNotifications(partner, { now: checkedAt }),
      });
    } catch (error) {
      console.error("[backoffice-notifications]", error);
      return res.status(503).json({ ok: false, error: "notifications_unavailable" });
    }
  });
  return router;
}
