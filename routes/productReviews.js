import express from "express";
import {
  getReviewItemsFromSale,
  isReviewableProductName,
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

const positiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseDateParam = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateRangeWhere = (field, from, to) => {
  const filter = {};
  if (from) filter.gte = from;
  if (to) filter.lte = to;
  return Object.keys(filter).length ? { [field]: filter } : {};
};

const countRows = (rows = [], key = "status") =>
  rows.reduce((acc, row) => {
    acc[row[key]] = row._count?._all || 0;
    return acc;
  }, {});

const percent = (part, total) => {
  const safeTotal = Number(total || 0);
  if (!safeTotal) return 0;
  return Math.round((Number(part || 0) / safeTotal) * 100);
};

const displayName = (customer, fallback = "Cliente sin nombre") =>
  String(customer?.name || fallback || "Cliente sin nombre").trim();

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

  router.get("/analytics/summary", async (req, res) => {
    const partnerId = positiveInt(req.query.partnerId);
    const storeId = positiveInt(req.query.storeId);
    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);

    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partner_required" });
    }

    const baseWhere = {
      partnerId,
      ...(storeId ? { storeId } : {}),
    };
    const requestWhere = {
      ...baseWhere,
      ...dateRangeWhere("createdAt", from, to),
    };
    const voteWhere = {
      ...baseWhere,
      ...dateRangeWhere("createdAt", from, to),
    };
    const sentRequestWhere = {
      ...baseWhere,
      sentAt: { not: null, ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
    };
    const respondedRequestWhere = {
      ...baseWhere,
      respondedAt: { not: null, ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
    };

    try {
      const [
        requestStatusRows,
        totalRequests,
        sentMessages,
        usedMessages,
        voteRows,
        productRows,
        storeVoteRows,
        stores,
        recentVotes,
        recentLikes,
        lastLike,
      ] = await Promise.all([
        prisma.productReviewRequest.groupBy({
          by: ["status"],
          where: requestWhere,
          _count: { _all: true },
        }),
        prisma.productReviewRequest.count({ where: requestWhere }),
        prisma.productReviewRequest.count({ where: sentRequestWhere }),
        prisma.productReviewRequest.count({ where: respondedRequestWhere }),
        prisma.productReviewVote.groupBy({
          by: ["vote"],
          where: voteWhere,
          _count: { _all: true },
        }),
        prisma.productReviewVote.groupBy({
          by: ["productId", "productName", "vote"],
          where: voteWhere,
          _count: { _all: true },
        }),
        prisma.productReviewVote.groupBy({
          by: ["storeId", "vote"],
          where: voteWhere,
          _count: { _all: true },
        }),
        prisma.store.findMany({
          where: { partnerId },
          select: { id: true, storeName: true, city: true, active: true },
          orderBy: { storeName: "asc" },
        }),
        prisma.productReviewVote.findMany({
          where: voteWhere,
          take: 16,
          orderBy: { createdAt: "desc" },
          include: {
            customer: { select: { id: true, name: true, phone: true, email: true } },
            store: { select: { id: true, storeName: true, city: true } },
            sale: { select: { id: true, code: true, date: true } },
          },
        }),
        prisma.productReviewVote.findMany({
          where: { ...voteWhere, vote: "LIKE" },
          take: 500,
          orderBy: { createdAt: "desc" },
          include: {
            customer: { select: { id: true, name: true, phone: true, email: true } },
            store: { select: { id: true, storeName: true, city: true } },
            request: { select: { customerPhone: true } },
          },
        }),
        prisma.productReviewVote.findFirst({
          where: { ...voteWhere, vote: "LIKE" },
          orderBy: { createdAt: "desc" },
          include: {
            customer: { select: { id: true, name: true, phone: true, email: true } },
            store: { select: { id: true, storeName: true, city: true } },
            sale: { select: { id: true, code: true, date: true } },
          },
        }),
      ]);

      const requestStatus = countRows(requestStatusRows);
      const voteCounts = countRows(voteRows, "vote");
      const likes = voteCounts.LIKE || 0;
      const dislikes = voteCounts.DISLIKE || 0;
      const receivedVotes = likes + dislikes;

      const productMap = new Map();
      productRows.filter((row) => isReviewableProductName(row.productName)).forEach((row) => {
        const key = `${row.productId || "custom"}:${row.productName || ""}`;
        const current = productMap.get(key) || {
          productId: row.productId,
          productName: row.productName || "Producto",
          likes: 0,
          dislikes: 0,
        };
        if (row.vote === "LIKE") current.likes += row._count?._all || 0;
        if (row.vote === "DISLIKE") current.dislikes += row._count?._all || 0;
        productMap.set(key, current);
      });

      const topProducts = [...productMap.values()]
        .map((item) => ({
          ...item,
          total: item.likes + item.dislikes,
          approval: percent(item.likes, item.likes + item.dislikes),
        }))
        .sort(
          (left, right) =>
            right.approval - left.approval ||
            right.likes - left.likes ||
            right.total - left.total ||
            left.productName.localeCompare(right.productName)
        )
        .slice(0, 8);

      const productsToReview = [...productMap.values()]
        .map((item) => ({
          ...item,
          total: item.likes + item.dislikes,
          approval: percent(item.likes, item.likes + item.dislikes),
        }))
        .filter((item) => item.dislikes > 0)
        .sort(
          (left, right) =>
            right.dislikes - left.dislikes ||
            left.approval - right.approval ||
            right.total - left.total ||
            left.productName.localeCompare(right.productName)
        )
        .slice(0, 6);

      const storeMap = new Map(
        stores.map((store) => [
          store.id,
          {
            ...store,
            likes: 0,
            dislikes: 0,
          },
        ])
      );
      storeVoteRows.forEach((row) => {
        const current = storeMap.get(row.storeId);
        if (!current) return;
        if (row.vote === "LIKE") current.likes += row._count?._all || 0;
        if (row.vote === "DISLIKE") current.dislikes += row._count?._all || 0;
      });

      const storeBreakdown = [...storeMap.values()]
        .map((item) => ({
          ...item,
          total: item.likes + item.dislikes,
          approval: percent(item.likes, item.likes + item.dislikes),
        }))
        .sort((left, right) => right.total - left.total || left.storeName.localeCompare(right.storeName));

      const peopleByKey = new Map();
      recentLikes.filter((vote) => isReviewableProductName(vote.productName)).forEach((vote) => {
        const phone = vote.customer?.phone || vote.request?.customerPhone || "";
        const key = vote.customerId ? `customer:${vote.customerId}` : phone ? `phone:${phone}` : `vote:${vote.id}`;
        const current = peopleByKey.get(key) || {
          customerId: vote.customerId,
          name: displayName(vote.customer, phone || "Cliente sin nombre"),
          phone,
          email: vote.customer?.email || "",
          likes: 0,
          lastLikeAt: vote.createdAt,
          lastProductName: vote.productName,
          lastStoreName: vote.store?.storeName || "",
        };

        current.likes += 1;
        if (new Date(vote.createdAt).getTime() >= new Date(current.lastLikeAt).getTime()) {
          current.lastLikeAt = vote.createdAt;
          current.lastProductName = vote.productName;
          current.lastStoreName = vote.store?.storeName || "";
        }
        peopleByKey.set(key, current);
      });

      const likePeople = [...peopleByKey.values()]
        .sort((left, right) => right.likes - left.likes || new Date(right.lastLikeAt) - new Date(left.lastLikeAt))
        .slice(0, 12);

      return res.json({
        ok: true,
        filters: { partnerId, storeId, from, to },
        summary: {
          totalRequests,
          sentMessages,
          usedMessages,
          receivedVotes,
          likes,
          dislikes,
          pendingMessages: requestStatus.PENDING || 0,
          failedMessages: requestStatus.FAILED || 0,
          skippedMessages: requestStatus.SKIPPED || 0,
          responseRate: percent(usedMessages, sentMessages),
          likeRate: percent(likes, receivedVotes),
          lastLikeAt: lastLike?.createdAt || null,
        },
        requestStatus,
        stores: storeBreakdown,
        topProducts,
        productsToReview,
        likePeople,
        lastLike: lastLike && isReviewableProductName(lastLike.productName)
          ? {
              id: lastLike.id,
              productName: lastLike.productName,
              createdAt: lastLike.createdAt,
              customerName: displayName(lastLike.customer),
              customerPhone: lastLike.customer?.phone || "",
              storeName: lastLike.store?.storeName || "",
              saleCode: lastLike.sale?.code || "",
            }
          : null,
        recentVotes: recentVotes
          .filter((vote) => isReviewableProductName(vote.productName))
          .map((vote) => ({
            id: vote.id,
            vote: vote.vote,
            productName: vote.productName,
            createdAt: vote.createdAt,
            customerName: displayName(vote.customer),
            customerPhone: vote.customer?.phone || "",
            storeName: vote.store?.storeName || "",
            saleCode: vote.sale?.code || "",
          })),
      });
    } catch (error) {
      console.error("[product-reviews.analytics] error:", error);
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
