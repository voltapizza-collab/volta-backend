import express from "express";

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const asNumberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const cleanDays = (value) => {
  if (!Array.isArray(value)) return null;
  const days = value
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  return days.length ? [...new Set(days)].sort() : null;
};

const asMinutesOrNull = (value) => {
  const parsed = asNumberOrNull(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1440 ? parsed : null;
};

const isInWindow = (minutesNow, start, end) => {
  if (start == null || end == null) return true;
  return start <= end
    ? minutesNow >= start && minutesNow < end
    : minutesNow >= start || minutesNow < end;
};

const expandWindow = (start, end) => {
  if (start == null || end == null) return [[0, 1440]];
  if (start <= end) return [[start, end]];
  return [
    [start, 1440],
    [0, end],
  ];
};

const windowsOverlap = (aStart, aEnd, bStart, bEnd) => {
  const aParts = expandWindow(aStart, aEnd);
  const bParts = expandWindow(bStart, bEnd);

  return aParts.some(([aStartPart, aEndPart]) =>
    bParts.some(([bStartPart, bEndPart]) => aStartPart < bEndPart && bStartPart < aEndPart)
  );
};

const incentiveCollision = (newIncentive, existing) => {
  const newDays = Array.isArray(newIncentive.daysActive) ? newIncentive.daysActive : [];
  const existingDays = Array.isArray(existing.daysActive) ? existing.daysActive : [];
  const shareDay =
    !newDays.length ||
    !existingDays.length ||
    newDays.some((day) => existingDays.includes(day));

  if (!shareDay) return false;

  return windowsOverlap(
    newIncentive.windowStart,
    newIncentive.windowEnd,
    existing.windowStart,
    existing.windowEnd
  );
};

const serializeIncentive = (incentive) => ({
  id: incentive.id,
  partnerId: incentive.partnerId,
  name: incentive.name,
  triggerMode: incentive.triggerMode,
  fixedAmount: incentive.fixedAmount,
  percentOverAvg: incentive.percentOverAvg,
  rewardPizzaId: incentive.rewardPizzaId,
  rewardPizza: incentive.rewardPizza
    ? {
        id: incentive.rewardPizza.id,
        name: incentive.rewardPizza.name,
        image: incentive.rewardPizza.image,
        status: incentive.rewardPizza.status,
      }
    : null,
  active: incentive.active,
  startsAt: incentive.startsAt,
  endsAt: incentive.endsAt,
  daysActive: Array.isArray(incentive.daysActive) ? incentive.daysActive : [],
  windowStart: incentive.windowStart,
  windowEnd: incentive.windowEnd,
  createdAt: incentive.createdAt,
  updatedAt: incentive.updatedAt,
});

const getRewardPizza = async (prisma, partnerId, rewardPizzaId) => {
  const rewardId = parsePositiveInt(rewardPizzaId);
  if (!rewardId) return null;

  return prisma.menuPizza.findFirst({
    where: {
      id: rewardId,
      partnerId,
      status: "ACTIVE",
      type: "SELLABLE",
    },
    select: { id: true },
  });
};

const assertNoActiveCollision = async (prisma, partnerId, candidate, excludeId = null) => {
  if (!candidate.active) return null;

  const existing = await prisma.incentive.findMany({
    where: {
      partnerId,
      active: true,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });

  return existing.find((incentive) => incentiveCollision(candidate, incentive)) || null;
};

const buildScheduleCandidate = (payload, current = {}) => ({
  active: payload.active ?? current.active ?? false,
  daysActive: payload.daysActive !== undefined ? cleanDays(payload.daysActive) : current.daysActive,
  windowStart:
    payload.windowStart !== undefined ? asMinutesOrNull(payload.windowStart) : current.windowStart,
  windowEnd: payload.windowEnd !== undefined ? asMinutesOrNull(payload.windowEnd) : current.windowEnd,
});

export default function incentivesRoutes(prisma) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId_required" });
    }

    try {
      const incentives = await prisma.incentive.findMany({
        where: { partnerId },
        orderBy: [{ active: "desc" }, { windowStart: "asc" }, { createdAt: "desc" }],
        include: {
          rewardPizza: {
            select: { id: true, name: true, image: true, status: true },
          },
        },
      });

      return res.json({ ok: true, incentives: incentives.map(serializeIncentive) });
    } catch (error) {
      console.error("[incentives.get] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.get("/active/one", async (req, res) => {
    const partnerId = parsePositiveInt(req.query.partnerId);
    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partnerId_required" });
    }

    try {
      const timeZone = process.env.TIMEZONE || "Europe/Madrid";
      const now = new Date(new Date().toLocaleString("en-US", { timeZone }));
      const minutesNow = now.getHours() * 60 + now.getMinutes();
      const dayNow = now.getDay();
      const incentives = await prisma.incentive.findMany({
        where: { partnerId, active: true },
        orderBy: { windowStart: "asc" },
        include: {
          rewardPizza: {
            select: { id: true, name: true, image: true, status: true },
          },
        },
      });

      let active = null;
      let next = null;
      let nextStartsInMs = null;

      for (const incentive of incentives) {
        if (incentive.startsAt && incentive.startsAt > now) {
          const diff = incentive.startsAt.getTime() - now.getTime();
          if (nextStartsInMs == null || diff < nextStartsInMs) {
            next = incentive;
            nextStartsInMs = diff;
          }
          continue;
        }

        if (incentive.endsAt && incentive.endsAt < now) continue;

        const daysActive = Array.isArray(incentive.daysActive) ? incentive.daysActive : [];
        if (daysActive.length && !daysActive.includes(dayNow)) continue;

        if (isInWindow(minutesNow, incentive.windowStart, incentive.windowEnd)) {
          active = incentive;
          break;
        }

        if (incentive.windowStart != null && incentive.windowStart > minutesNow) {
          const ms = (incentive.windowStart - minutesNow) * 60 * 1000;
          if (nextStartsInMs == null || ms < nextStartsInMs) {
            next = incentive;
            nextStartsInMs = ms;
          }
        }
      }

      return res.json({
        ok: true,
        active: active ? serializeIncentive(active) : null,
        next: next
          ? {
              id: next.id,
              name: next.name,
              startsInMs: nextStartsInMs,
            }
          : null,
      });
    } catch (error) {
      console.error("[incentives.active] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.post("/", async (req, res) => {
    const partnerId = parsePositiveInt(req.body.partnerId);
    const name = String(req.body.name || "").trim();
    const rewardPizzaId = parsePositiveInt(req.body.rewardPizzaId);
    const triggerMode = req.body.triggerMode;

    if (!partnerId || !name || !rewardPizzaId || !triggerMode) {
      return res.status(400).json({ ok: false, error: "missing_required_fields" });
    }

    if (!["FIXED", "SMART_AVG_TICKET"].includes(triggerMode)) {
      return res.status(400).json({ ok: false, error: "invalid_trigger_mode" });
    }

    if ((req.body.windowStart != null && req.body.windowEnd == null) || (req.body.windowStart == null && req.body.windowEnd != null)) {
      return res.status(400).json({ ok: false, error: "bad_time_window" });
    }

    try {
      const rewardPizza = await getRewardPizza(prisma, partnerId, rewardPizzaId);
      if (!rewardPizza) {
        return res.status(404).json({ ok: false, error: "reward_pizza_not_found" });
      }

      const candidate = buildScheduleCandidate(req.body);
      const collision = await assertNoActiveCollision(prisma, partnerId, candidate);
      if (collision) {
        return res.status(409).json({
          ok: false,
          error: "schedule_conflict",
          message: `Horario en conflicto con incentivo "${collision.name}"`,
        });
      }

      const incentive = await prisma.incentive.create({
        data: {
          partnerId,
          name,
          triggerMode,
          fixedAmount: triggerMode === "FIXED" ? asNumberOrNull(req.body.fixedAmount) : null,
          percentOverAvg:
            triggerMode === "SMART_AVG_TICKET" ? asNumberOrNull(req.body.percentOverAvg) : null,
          rewardPizzaId,
          active: Boolean(req.body.active),
          startsAt: asDateOrNull(req.body.startsAt),
          endsAt: asDateOrNull(req.body.endsAt),
          daysActive: cleanDays(req.body.daysActive),
          windowStart: asMinutesOrNull(req.body.windowStart),
          windowEnd: asMinutesOrNull(req.body.windowEnd),
        },
        include: {
          rewardPizza: {
            select: { id: true, name: true, image: true, status: true },
          },
        },
      });

      return res.json({ ok: true, incentive: serializeIncentive(incentive) });
    } catch (error) {
      console.error("[incentives.post] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.patch("/:id/activate", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const partnerId = parsePositiveInt(req.body.partnerId || req.query.partnerId);
    if (!id || !partnerId) {
      return res.status(400).json({ ok: false, error: "bad_payload" });
    }

    try {
      const existing = await prisma.incentive.findFirst({
        where: { id, partnerId },
        include: {
          rewardPizza: {
            select: { id: true, name: true, image: true, status: true },
          },
        },
      });

      if (!existing) {
        return res.status(404).json({ ok: false, error: "incentive_not_found" });
      }

      const collision = await assertNoActiveCollision(
        prisma,
        partnerId,
        {
          active: true,
          daysActive: existing.daysActive,
          windowStart: existing.windowStart,
          windowEnd: existing.windowEnd,
        },
        id
      );

      if (collision) {
        return res.status(409).json({
          ok: false,
          error: "schedule_conflict",
          message: `Horario en conflicto con incentivo "${collision.name}"`,
        });
      }

      const incentive = await prisma.incentive.update({
        where: { id },
        data: { active: true },
        include: {
          rewardPizza: {
            select: { id: true, name: true, image: true, status: true },
          },
        },
      });

      return res.json({ ok: true, incentive: serializeIncentive(incentive) });
    } catch (error) {
      console.error("[incentives.activate] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.patch("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const partnerId = parsePositiveInt(req.body.partnerId || req.query.partnerId);
    if (!id || !partnerId) {
      return res.status(400).json({ ok: false, error: "bad_payload" });
    }

    try {
      const existing = await prisma.incentive.findFirst({
        where: { id, partnerId },
      });

      if (!existing) {
        return res.status(404).json({ ok: false, error: "incentive_not_found" });
      }

      const data = {};
      if (req.body.name != null) data.name = String(req.body.name).trim();
      if (req.body.triggerMode != null) {
        if (!["FIXED", "SMART_AVG_TICKET"].includes(req.body.triggerMode)) {
          return res.status(400).json({ ok: false, error: "invalid_trigger_mode" });
        }
        data.triggerMode = req.body.triggerMode;
      }
      if (req.body.active != null) data.active = Boolean(req.body.active);
      if (req.body.startsAt !== undefined) data.startsAt = asDateOrNull(req.body.startsAt);
      if (req.body.endsAt !== undefined) data.endsAt = asDateOrNull(req.body.endsAt);
      if (req.body.daysActive !== undefined) data.daysActive = cleanDays(req.body.daysActive);

      if ((req.body.windowStart != null && req.body.windowEnd == null) || (req.body.windowStart == null && req.body.windowEnd != null)) {
        return res.status(400).json({ ok: false, error: "bad_time_window" });
      }
      if (req.body.windowStart !== undefined) data.windowStart = asMinutesOrNull(req.body.windowStart);
      if (req.body.windowEnd !== undefined) data.windowEnd = asMinutesOrNull(req.body.windowEnd);

      if (req.body.rewardPizzaId != null) {
        const rewardPizzaId = parsePositiveInt(req.body.rewardPizzaId);
        const rewardPizza = await getRewardPizza(prisma, partnerId, rewardPizzaId);
        if (!rewardPizza) {
          return res.status(404).json({ ok: false, error: "reward_pizza_not_found" });
        }
        data.rewardPizzaId = rewardPizzaId;
      }

      const nextTriggerMode = data.triggerMode || existing.triggerMode;
      if (nextTriggerMode === "FIXED") {
        data.fixedAmount = asNumberOrNull(req.body.fixedAmount ?? existing.fixedAmount);
        data.percentOverAvg = null;
      }

      if (nextTriggerMode === "SMART_AVG_TICKET") {
        data.percentOverAvg = asNumberOrNull(req.body.percentOverAvg ?? existing.percentOverAvg);
        data.fixedAmount = null;
      }

      const candidate = buildScheduleCandidate(req.body, existing);
      const collision = await assertNoActiveCollision(prisma, partnerId, candidate, id);
      if (collision) {
        return res.status(409).json({
          ok: false,
          error: "schedule_conflict",
          message: `Horario en conflicto con incentivo "${collision.name}"`,
        });
      }

      const incentive = await prisma.incentive.update({
        where: { id },
        data,
        include: {
          rewardPizza: {
            select: { id: true, name: true, image: true, status: true },
          },
        },
      });

      return res.json({ ok: true, incentive: serializeIncentive(incentive) });
    } catch (error) {
      console.error("[incentives.patch] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const partnerId = parsePositiveInt(req.query.partnerId);
    if (!id || !partnerId) {
      return res.status(400).json({ ok: false, error: "bad_payload" });
    }

    try {
      const existing = await prisma.incentive.findFirst({
        where: { id, partnerId },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ ok: false, error: "incentive_not_found" });
      }

      await prisma.incentive.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (error) {
      console.error("[incentives.delete] error:", error);
      return res.status(500).json({ ok: false, error: "server" });
    }
  });

  return router;
}
