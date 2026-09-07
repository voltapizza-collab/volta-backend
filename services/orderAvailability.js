const STEP = 15;
const OPEN_OFFSET = 30;
const DAYS = 5;
const DAY_MS = 86400000;
const clockFormatters = new Map();

const minute = (value) => {
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }
  return value == null || value === "" ? NaN : Number(value);
};

// Calendar arithmetic uses UTC fields for the restaurant's wall clock, never the host TZ.
const wallClock = (date, timeZone) => {
  if (!clockFormatters.has(timeZone)) clockFormatters.set(timeZone, new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }));
  const parts = Object.fromEntries(clockFormatters.get(timeZone).formatToParts(date).map(({ type, value }) => [type, value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
};

export const buildOrderAvailability = (store, now = new Date(), timeZone = process.env.TIMEZONE || "Europe/Madrid") => {
  const acceptingOrders = Boolean(store) && store.active !== false && store.acceptingOrders !== false;
  const wallNow = wallClock(now, timeZone);
  const today = Math.floor(wallNow / DAY_MS) * DAY_MS;
  const hours = Array.isArray(store?.hours) ? store.hours : [];
  const windows = [];
  for (let day = -1; day < DAYS; day += 1) {
    const date = today + day * DAY_MS;
    const rows = hours.length
      ? hours.filter((row) => Number(row.dayOfWeek) === new Date(date).getUTCDay())
      : [{ openTime: 14 * 60, closeTime: 23 * 60 + 30 }];
    for (const row of rows) {
      const start = minute(row.openTime);
      const end = minute(row.closeTime);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= 1440 || end < 0 || end > 1440) continue;
      windows.push({ start: date + start * 60000, end: date + (end <= start ? end + 1440 : end) * 60000 });
    }
  }
  // Existing stores without configured hours allow immediate orders.
  const currentWindow = windows.find((window) => wallNow >= window.start && wallNow < window.end);
  const operationsPaused = store?.operationsPaused === true;
  const serviceOpen = !operationsPaused && (!hours.length || Boolean(currentWindow));
  const days = Array.from({ length: DAYS }, (_, offset) => {
    const date = new Date(today + offset * DAY_MS).toISOString().slice(0, 10);
    return { date, slots: [] };
  });
  // Enumerating real instants also handles missing/repeated hours at DST transitions.
  const first = Math.ceil(now.getTime() / (STEP * 60000)) * STEP * 60000;
  if (acceptingOrders) for (let instant = first; instant < now.getTime() + (DAYS + 1) * DAY_MS; instant += STEP * 60000) {
    if (instant <= now.getTime()) continue;
    const wall = wallClock(new Date(instant), timeZone);
    const day = days.find((item) => item.date === new Date(wall).toISOString().slice(0, 10));
    if (!day || !windows.some((window) => wall >= window.start + OPEN_OFFSET * 60000 && wall <= window.end)) continue;
    const time = new Date(wall).toISOString().slice(11, 16);
    day.slots.push({ time, scheduledFor: new Date(instant).toISOString() });
  }
  return { acceptingOrders, serviceOpen, operationsPaused, requiresSchedule: !serviceOpen, timeZone, days };
};

export const validateOrderSchedule = (store, scheduledFor, now = new Date()) => {
  const availability = buildOrderAvailability(store, now);
  let error = null;
  if (!availability.acceptingOrders) error = "store_closed";
  else if (scheduledFor == null || scheduledFor === "") {
    if (availability.requiresSchedule) error = "schedule_required";
  } else {
    const parsed = typeof scheduledFor === "string" ? new Date(scheduledFor) : new Date(NaN);
    if (!Number.isFinite(parsed.getTime()) || !availability.days.some((day) =>
      day.slots.some((slot) => slot.scheduledFor === parsed.toISOString()))) error = "schedule_invalid";
  }
  if (error) throw Object.assign(new Error(error), { status: 409, availability });
  return availability;
};
