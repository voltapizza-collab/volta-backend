import express from "express";
import {
  getReviewItemsFromSale,
  processDueProductReviewRequests,
  sendProductReviewRequestSms,
  REVIEW_STATUS,
} from "../services/productReviews.js";

const cleanToken = (value) => String(value || "").trim();

const normalizeVote = (value) => {
  const vote = String(value || "").trim().toUpperCase();
  return vote === "LIKE" || vote === "DISLIKE" ? vote : null;
};

const mapVotesByLine = (votes = []) =>
  new Map(votes.map((vote) => [vote.lineKey, vote.vote]));

export default function productReviewsRoutes(prisma) {
  const router = express.Router();

  router.post("/worker/process-due", async (_req, res) => {
    try {
      const result = await processDueProductReviewRequests(prisma);
      return res.json(result);
    } catch (error) {
      console.error("[product-reviews.worker-route] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.get("/:token", async (req, res) => {
    const token = cleanToken(req.params.token);
    if (!token) return res.status(400).json({ ok: false, error: "token_required" });

    try {
      const request = await prisma.productReviewRequest.findUnique({
        where: { token },
        include: {
          sale: {
            include: {
              partner: { select: { id: true, name: true, slug: true, currency: true } },
              store: { select: { id: true, storeName: true, slug: true } },
              customer: { select: { id: true, name: true } },
            },
          },
          votes: true,
        },
      });

      if (!request || !request.sale || request.sale.status === "CANCELED") {
        return res.status(404).json({ ok: false, error: "review_not_found" });
      }

      const voteByLine = mapVotesByLine(request.votes);
      const items = getReviewItemsFromSale(request.sale).map((item) => ({
        ...item,
        vote: voteByLine.get(item.lineKey) || null,
      }));

      return res.json({
        ok: true,
        review: {
          token: request.token,
          status: request.status,
          respondedAt: request.respondedAt,
          orderCode: request.sale.code,
          partnerName: request.sale.partner?.name || "VoltaPizza",
          partnerSlug: request.sale.partner?.slug || "",
          storeName: request.sale.store?.storeName || "",
          storeSlug: request.sale.store?.slug || "",
          customerName:
            request.sale.customerData?.name ||
            request.sale.customer?.name ||
            "Cliente",
          items,
        },
      });
    } catch (error) {
      console.error("[product-reviews.get] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/:token", async (req, res) => {
    const token = cleanToken(req.params.token);
    const incomingVotes = Array.isArray(req.body?.votes) ? req.body.votes : [];

    if (!token) return res.status(400).json({ ok: false, error: "token_required" });
    if (!incomingVotes.length) return res.status(400).json({ ok: false, error: "votes_required" });

    try {
      const request = await prisma.productReviewRequest.findUnique({
        where: { token },
        include: { sale: true },
      });

      if (!request || !request.sale || request.sale.status === "CANCELED") {
        return res.status(404).json({ ok: false, error: "review_not_found" });
      }

      const reviewItems = getReviewItemsFromSale(request.sale);
      const itemByLine = new Map(reviewItems.map((item) => [item.lineKey, item]));
      const validVotes = incomingVotes
        .map((item) => {
          const lineKey = String(item?.lineKey || "").trim();
          const vote = normalizeVote(item?.vote);
          const reviewItem = itemByLine.get(lineKey);

          if (!lineKey || !vote || !reviewItem) return null;
          return { ...reviewItem, vote };
        })
        .filter(Boolean);

      if (!validVotes.length) {
        return res.status(400).json({ ok: false, error: "no_valid_votes" });
      }

      await prisma.$transaction([
        ...validVotes.map((item) =>
          prisma.productReviewVote.upsert({
            where: {
              requestId_lineKey: {
                requestId: request.id,
                lineKey: item.lineKey,
              },
            },
            update: {
              vote: item.vote,
              productId: item.productId,
              productName: item.name,
            },
            create: {
              requestId: request.id,
              saleId: request.saleId,
              partnerId: request.partnerId,
              storeId: request.storeId,
              customerId: request.customerId,
              productId: item.productId,
              lineKey: item.lineKey,
              productName: item.name,
              vote: item.vote,
            },
          })
        ),
        prisma.productReviewRequest.update({
          where: { id: request.id },
          data: {
            status: REVIEW_STATUS.RESPONDED,
            respondedAt: new Date(),
          },
        }),
      ]);

      const updated = await prisma.productReviewRequest.findUnique({
        where: { id: request.id },
        include: { votes: true, sale: true },
      });
      const voteByLine = mapVotesByLine(updated?.votes || []);

      return res.json({
        ok: true,
        status: REVIEW_STATUS.RESPONDED,
        items: reviewItems.map((item) => ({
          ...item,
          vote: voteByLine.get(item.lineKey) || null,
        })),
      });
    } catch (error) {
      console.error("[product-reviews.post] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/:token/send-now", async (req, res) => {
    const token = cleanToken(req.params.token);
    if (!token) return res.status(400).json({ ok: false, error: "token_required" });

    try {
      const request = await prisma.productReviewRequest.findUnique({ where: { token } });
      if (!request) return res.status(404).json({ ok: false, error: "review_not_found" });

      const result = await sendProductReviewRequestSms(prisma, request);
      return res.json({ ok: Boolean(result.ok), result });
    } catch (error) {
      console.error("[product-reviews.send-now] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  return router;
}
