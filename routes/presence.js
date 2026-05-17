import express from "express";

const ACTIVE_WINDOW_MS = 30_000;
const MAX_SESSIONS = 5000;
const sessions = new Map();

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const sanitizeId = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 120);

const pruneExpired = (now = Date.now()) => {
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastSeenAtMs > ACTIVE_WINDOW_MS) {
      sessions.delete(key);
    }
  }

  if (sessions.size <= MAX_SESSIONS) return;

  const staleFirst = [...sessions.entries()].sort(
    (left, right) => left[1].lastSeenAtMs - right[1].lastSeenAtMs
  );

  staleFirst.slice(0, sessions.size - MAX_SESSIONS).forEach(([key]) => {
    sessions.delete(key);
  });
};

const summarizeStore = ({ partnerId, storeId }) => {
  const now = Date.now();
  pruneExpired(now);

  const active = [...sessions.values()].filter(
    (session) =>
      session.storeId === storeId &&
      (!partnerId || session.partnerId === partnerId) &&
      now - session.lastSeenAtMs <= ACTIVE_WINDOW_MS
  );

  const checkoutVisitors = active.filter((session) => session.state === "checkout").length;
  const cartVisitors = active.filter((session) => session.state === "cart").length;

  return {
    activeVisitors: active.length,
    cartVisitors,
    checkoutVisitors,
    browsingVisitors: Math.max(active.length - cartVisitors - checkoutVisitors, 0),
    activeWindowMs: ACTIVE_WINDOW_MS,
    updatedAt: new Date(now).toISOString(),
  };
};

export default function presenceRoutes() {
  const router = express.Router();

  router.post("/heartbeat", (req, res) => {
    const partnerId = parsePositiveInt(req.body?.partnerId);
    const storeId = parsePositiveInt(req.body?.storeId);
    const visitorId = sanitizeId(req.body?.visitorId);

    if (!partnerId || !storeId || !visitorId) {
      return res.status(400).json({ error: "partnerId, storeId and visitorId required" });
    }

    const state = ["checkout", "cart", "browsing"].includes(req.body?.state)
      ? req.body.state
      : "browsing";
    const now = Date.now();
    const key = `${storeId}:${visitorId}`;

    sessions.set(key, {
      partnerId,
      storeId,
      visitorId,
      state,
      path: String(req.body?.path || "").slice(0, 240),
      lastSeenAtMs: now,
      lastSeenAt: new Date(now).toISOString(),
    });

    return res.json({
      ok: true,
      storeId,
      presence: summarizeStore({ partnerId, storeId }),
    });
  });

  router.get("/stores/:storeId/status", (req, res) => {
    const storeId = parsePositiveInt(req.params.storeId);
    const partnerId = req.query.partnerId ? parsePositiveInt(req.query.partnerId) : null;

    if (!storeId) {
      return res.status(400).json({ error: "Valid storeId required" });
    }

    return res.json({
      ok: true,
      storeId,
      presence: summarizeStore({ partnerId, storeId }),
    });
  });

  return router;
}
