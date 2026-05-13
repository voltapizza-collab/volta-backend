import express from "express";
import { normalizeE164Phone, sendTelnyxSms } from "../services/telnyx.js";
import {
  reserveSmsCreditForMessage,
  refundSmsCreditForMessage,
} from "../services/smsCredits.js";

const router = express.Router();
const TZ = process.env.TIMEZONE || "Europe/Madrid";
const LOCK_HOURS = 24;

const BUILT_IN_GAMES = [
  {
    name: "Numero ganador",
    slug: "winning-number",
    description: "Tres intentos para acertar el numero ganador.",
  },
  {
    name: "Perfect Timing",
    slug: "perfect-timing",
    description: "Deten el cronometro lo mas cerca posible de 9.99 segundos.",
  },
  {
    name: "Borde perfecto",
    slug: "crust-ring",
    description: "Ajusta el borde al diametro exacto de la pizza.",
  },
];

const normalizePhone = (value = "") => String(value).replace(/[^\d]/g, "");

const toE164ES = (value = "") => {
  const digits = normalizePhone(value);
  if (digits.length === 9) return `+34${digits}`;
  if (digits.length === 11 && digits.startsWith("34")) return `+${digits}`;
  return null;
};

const base9Phone = (value = "") => {
  const digits = normalizePhone(value);
  if (digits.length === 9) return digits;
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  return null;
};

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const nowInTZ = () => {
  const snapshot = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  return new Date(snapshot.replace(" ", "T"));
};

const minutesOfDay = (dateLike) => {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return date.getHours() * 60 + date.getMinutes();
};

const esDayToNum = (value) => {
  const map = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    "miércoles": 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    "sábado": 6,
  };
  const normalized = String(value || "").toLowerCase();
  return normalized in map ? map[normalized] : null;
};

const normalizeDaysActive = (value) => {
  if (!value) return [];
  let list = value;

  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = [value];
    }
  }

  if (!Array.isArray(list)) list = [list];

  return [
    ...new Set(
      list
        .map((item) => {
          if (typeof item === "number" && item >= 0 && item <= 6) return item;
          return esDayToNum(item);
        })
        .filter((item) => item != null)
    ),
  ];
};

const isActiveByDate = (coupon, reference = nowInTZ()) => {
  const current = reference.getTime();
  if (coupon.activeFrom && new Date(coupon.activeFrom).getTime() > current) return false;
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= current) return false;
  return true;
};

const isWithinWindow = (coupon, reference = nowInTZ()) => {
  const days = normalizeDaysActive(coupon.daysActive);
  if (!days.length && coupon.windowStart == null && coupon.windowEnd == null) return true;
  if (days.length && !days.includes(reference.getDay())) return false;

  const start = coupon.windowStart == null ? 0 : Number(coupon.windowStart);
  const end = coupon.windowEnd == null ? 24 * 60 : Number(coupon.windowEnd);
  const minutes = minutesOfDay(reference);

  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
};

const readCouponMeta = (coupon) => {
  if (!coupon?.meta || typeof coupon.meta !== "object" || Array.isArray(coupon.meta)) return {};
  return coupon.meta;
};

const couponTitle = (coupon) => {
  if (coupon.kind === "PERCENT" && coupon.variant === "RANGE") {
    return `${coupon.percentMin || 0}-${coupon.percentMax || 0}%`;
  }
  if (coupon.kind === "PERCENT") return `${coupon.percent || 0}%`;
  if (coupon.amount != null) return `${Number(coupon.amount).toFixed(2)} EUR`;
  return "Cupon";
};

async function findOrCreateCustomer(prisma, { partnerId, phone, name }) {
  const normalizedPhone = toE164ES(phone);
  const base9 = base9Phone(phone);
  if (!normalizedPhone || !base9) throw new Error("invalid_phone");

  const existing = await prisma.customer.findFirst({
    where: { partnerId, phone: { contains: base9 } },
  });

  if (existing) return existing;

  const code = `CUS-${Math.floor(10000 + Math.random() * 90000)}`;
  return prisma.customer.create({
    data: {
      partnerId,
      code,
      name: name || `Cliente ${base9}`,
      phone: normalizedPhone,
      address_1: `(GAME) ${normalizedPhone}`,
      portal: "GAME_COUPON",
      origin: "QR",
    },
  });
}

async function ensureGame(prisma, partner, slug) {
  const builtIn = BUILT_IN_GAMES.find((item) => item.slug === slug);
  if (!builtIn) return null;

  return prisma.game.upsert({
    where: { partnerId_slug: { partnerId: partner.id, slug } },
    update: { active: true },
    create: {
      partnerId: partner.id,
      name: builtIn.name,
      slug: builtIn.slug,
      description: builtIn.description,
      active: true,
    },
  });
}

async function getPartnerAndGame(prisma, partnerSlug, gameSlug) {
  const partner = await prisma.partner.findUnique({
    where: { slug: partnerSlug },
    select: { id: true, name: true, slug: true, brandLogoUrl: true },
  });

  if (!partner) return { partner: null, game: null };
  const game = await ensureGame(prisma, partner, gameSlug);
  return { partner, game };
}

async function getLock(prisma, gameId) {
  const lastWin = await prisma.gamePlay.findFirst({
    where: { gameId, won: true },
    orderBy: { createdAt: "desc" },
  });

  if (!lastWin) return { lockedUntil: null, remainingMs: 0 };

  const lockedUntil = new Date(lastWin.createdAt.getTime() + LOCK_HOURS * 3600 * 1000);
  const remainingMs = lockedUntil.getTime() - Date.now();

  if (remainingMs <= 0) return { lockedUntil: null, remainingMs: 0 };
  return { lockedUntil, remainingMs };
}

function winningNumberFor(gameId) {
  const day = new Date().toISOString().slice(0, 10).replace(/\D/g, "");
  const seed = Number(day) + Number(gameId || 0) * 7919;
  return seed % 1000;
}

function evaluatePlay(game, body = {}) {
  if (game.slug === "perfect-timing") {
    const timeMs = Number(body.timeMs);
    const deltaMs = Math.abs(timeMs - 9990);
    return {
      won: Number.isFinite(timeMs) && deltaMs <= 40,
      result: { timeMs, targetMs: 9990, deltaMs, toleranceMs: 40 },
    };
  }

  if (game.slug === "crust-ring") {
    const fit = Number(body.fit);
    const delta = Math.abs(fit - 100);
    return {
      won: Number.isFinite(fit) && delta <= 3.5,
      result: { fit, target: 100, delta, tolerance: 3.5 },
    };
  }

  const target = winningNumberFor(game.id);
  const attempt = Math.floor(Math.random() * 1000);
  return {
    won: attempt === target,
    result: { attempt, target },
  };
}

async function sendGameCouponSms(prisma, { partner, coupon, customer }) {
  const to = normalizeE164Phone(customer?.phone);
  if (!to) return { sent: false, status: "failed", error: "invalid_phone" };

  const reservation = await reserveSmsCreditForMessage(prisma, {
    partnerId: coupon.partnerId,
    couponCode: coupon.code,
    customerId: customer.id,
    to,
  });

  if (!reservation.ok) {
    return { sent: false, status: "skipped", error: reservation.error || "insufficient_sms_credits" };
  }

  const text = `${partner.name}: premio desbloqueado. Usa tu cupon ${coupon.code} (${couponTitle(coupon)}).`;
  const result = await sendTelnyxSms({ to, text, tags: [`game-coupon:${coupon.code}`] });

  if (!result.ok) {
    await refundSmsCreditForMessage(prisma, {
      partnerId: coupon.partnerId,
      couponCode: coupon.code,
      customerId: customer.id,
      reason: result.error?.title || result.status,
    });
  }

  return {
    sent: Boolean(result.ok),
    status: result.status,
    error: result.error || null,
  };
}

export default function gamesRoutes(prisma) {
  router.get("/:partnerSlug/:gameSlug/status", async (req, res) => {
    const { partner, game } = await getPartnerAndGame(prisma, req.params.partnerSlug, req.params.gameSlug);
    if (!partner || !game) return res.status(404).json({ ok: false, error: "game_not_found" });

    const lock = await getLock(prisma, game.id);
    return res.json({
      ok: true,
      partner,
      game,
      ...lock,
      targetNumber: game.slug === "winning-number" ? winningNumberFor(game.id) : null,
    });
  });

  router.post("/:partnerSlug/:gameSlug/play", async (req, res) => {
    const { partner, game } = await getPartnerAndGame(prisma, req.params.partnerSlug, req.params.gameSlug);
    if (!partner || !game) return res.status(404).json({ ok: false, error: "game_not_found" });

    const lock = await getLock(prisma, game.id);
    if (lock.remainingMs > 0) {
      return res.status(423).json({ ok: false, error: "locked", ...lock });
    }

    const evaluation = evaluatePlay(game, req.body);
    const play = await prisma.gamePlay.create({
      data: {
        gameId: game.id,
        partnerId: partner.id,
        won: evaluation.won,
        result: evaluation.result,
        ip: req.ip,
      },
    });

    const nextLock = evaluation.won ? await getLock(prisma, game.id) : { lockedUntil: null, remainingMs: 0 };

    return res.json({
      ok: true,
      won: evaluation.won,
      playId: play.id,
      result: evaluation.result,
      ...nextLock,
    });
  });

  router.post("/:partnerSlug/:gameSlug/claim", async (req, res) => {
    const { partner, game } = await getPartnerAndGame(prisma, req.params.partnerSlug, req.params.gameSlug);
    if (!partner || !game) return res.status(404).json({ ok: false, error: "game_not_found" });

    const playId = parsePositiveInt(req.body.playId);
    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").trim();

    if (!playId) return res.status(400).json({ ok: false, error: "playId required" });
    if (!phone) return res.status(400).json({ ok: false, error: "phone required" });

    try {
      const play = await prisma.gamePlay.findFirst({
        where: { id: playId, gameId: game.id, partnerId: partner.id, won: true },
      });

      if (!play) return res.status(409).json({ ok: false, error: "winning_play_not_found" });

      const customer = await findOrCreateCustomer(prisma, { partnerId: partner.id, phone, name });
      const now = nowInTZ();
      const candidates = await prisma.coupon.findMany({
        where: {
          partnerId: partner.id,
          gameId: game.id,
          status: "ACTIVE",
          visibility: "PUBLIC",
          assignedToId: null,
        },
        orderBy: { createdAt: "asc" },
      });
      const coupon = candidates.find((candidate) => isActiveByDate(candidate, now) && isWithinWindow(candidate, now));

      if (!coupon) return res.status(409).json({ ok: false, error: "out_of_stock" });

      const expiresAt = coupon.expiresAt || new Date(now.getTime() + 48 * 3600 * 1000);
      const updated = await prisma.coupon.update({
        where: { id: coupon.id },
        data: {
          assignedToId: customer.id,
          visibility: "RESERVED",
          acquisition: "GAME",
          channel: "GAME",
          expiresAt,
          meta: {
            ...readCouponMeta(coupon),
            claimedFromGame: {
              gameId: game.id,
              gameSlug: game.slug,
              playId: play.id,
              claimedAt: new Date().toISOString(),
            },
          },
        },
      });

      const sms = await sendGameCouponSms(prisma, { partner, coupon: updated, customer });

      return res.json({
        ok: true,
        coupon: {
          code: updated.code,
          title: couponTitle(updated),
          expiresAt: updated.expiresAt,
        },
        sms,
      });
    } catch (error) {
      console.error("[games.claim] error:", error);
      return res.status(500).json({ ok: false, error: error.message === "invalid_phone" ? "invalid_phone" : "server" });
    }
  });

  return router;
}
