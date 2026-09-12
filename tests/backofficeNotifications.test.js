import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { backofficeAnnouncements } from "../data/backofficeAnnouncements.js";
import { buildSmsBalanceNotification, buildBackofficeNotifications, validateAnnouncement } from "../services/backofficeNotifications.js";
import backofficeNotificationsRoutes from "../routes/backofficeNotifications.js";

const partner = { id: 7, smsCredits: 10, smsLowBalanceThreshold: 50 };
const note = {
  id: "test-improvement", revision: 1, category: "improvement", severity: "info",
  title: "Una mejora", message: "Así funciona ahora", publishedAt: "2026-09-10T00:00:00Z",
};

test("SMS alerts cover the warning boundary, urgency, exhaustion and recovery", () => {
  for (const [balance, severity] of [[51, null], [50, "warning"], [11, "warning"], [10, "urgent"], [1, "urgent"], [0, "critical"], [-1, "critical"], [100, null]]) {
    const notice = buildSmsBalanceNotification({ ...partner, smsCredits: balance });
    assert.equal(notice?.severity || null, severity);
    if (notice) {
      assert.equal(notice.requiresAction, true);
      assert.equal(notice.action.target, "sms-credits");
      assert.equal(notice.remaining, Math.max(0, balance));
    }
  }
  assert.match(buildSmsBalanceNotification({ ...partner, smsCredits: 1 }).title, /queda 1 mensaje$/);
  assert.match(buildSmsBalanceNotification(partner).title, /quedan 10 mensajes$/);
});

test("custom warning thresholds never suppress the urgent 10 SMS alert; unknown balances are not zero", () => {
  assert.equal(buildSmsBalanceNotification({ ...partner, smsCredits: 60, smsLowBalanceThreshold: 75 }).severity, "warning");
  assert.equal(buildSmsBalanceNotification({ ...partner, smsLowBalanceThreshold: 0 }).severity, "urgent");
  for (const value of [null, undefined, NaN, "0"]) {
    assert.equal(buildSmsBalanceNotification({ ...partner, smsCredits: value }), null);
  }
});

test("release feed filters dates and audiences, orders urgent notices first and omits audience IDs", () => {
  const announcements = [
    note,
    { ...note, id: "future-release", publishedAt: "2026-10-01T00:00:00Z" },
    { ...note, id: "expired-release", expiresAt: "2026-09-11T00:00:00Z" },
    { ...note, id: "other-partner", partnerIds: [8] },
    { ...note, id: "this-partner", partnerIds: [7], publishedAt: "2026-09-11T00:00:00Z" },
    { ...note, id: "invalid-link", action: { label: "Abrir", target: "javascript:alert(1)" } },
  ];
  const result = buildBackofficeNotifications(partner, { now: "2026-09-12T00:00:00Z", announcements });
  assert.deepEqual(result.map((item) => item.id), ["sms-balance", "this-partner", "test-improvement"]);
  assert.equal(result[1].partnerIds, undefined);
  assert.equal(result[1].requiresAction, false);
});

test("every shipped announcement is valid and uniquely versioned", () => {
  assert.ok(backofficeAnnouncements.length > 0);
  for (const item of backofficeAnnouncements) {
    assert.ok(validateAnnouncement(item), item.id);
    for (const locale of ["en", "it", "fr", "pt"]) assert.ok(item.translations?.[locale]?.title, `${item.id}: ${locale}`);
  }
  assert.equal(new Set(backofficeAnnouncements.map((item) => item.id)).size, backofficeAnnouncements.length);
  for (const changes of [{ revision: 0 }, { severity: "unknown" }, { expiresAt: "invalid" }, { partnerIds: [] }, { partnerIds: ["7"] }, { title: "" }]) {
    assert.equal(validateAnnouncement({ ...note, ...changes }), false);
  }
});

test("translated release content is delivered and invalid translations are rejected", () => {
  const translated = { ...note, translations: { en: { title: "An improvement", message: "How it works" } } };
  assert.equal(validateAnnouncement(translated), true);
  const result = buildBackofficeNotifications({ ...partner, smsCredits: 100 }, { now: "2026-09-12T00:00:00Z", announcements: [translated] });
  assert.equal(result[0].translations.en.title, "An improvement");
  for (const translations of [[], "bad", { en: null }, { unknown: { title: "OK", message: "OK" } }, { en: { title: "", message: "OK" } }]) {
    assert.equal(validateAnnouncement({ ...note, translations }), false);
  }
  assert.equal(validateAnnouncement({ ...translated, action: { target: "settings", label: "Ajustes" } }), false);
});

test("notification endpoint reads only the requested partner, prevents caching and handles failures", async (t) => {
  const calls = [];
  const prisma = { partner: { findUnique: async (args) => {
    calls.push(args);
    if (args.where.id === 9) throw new Error("Unavailable");
    return args.where.id === 7 ? partner : null;
  } } };
  const app = express();
  app.use(backofficeNotificationsRoutes(prisma));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const invalid of ["0", "-1", "abc", "7foo", "1.5", "9007199254740992"]) {
    assert.equal((await fetch(`${base}/${invalid}`)).status, 400);
  }
  assert.equal(calls.length, 0);
  const response = await fetch(`${base}/7`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
  assert.equal(body.notifications[0].remaining, 10);
  assert.deepEqual(calls[0], { where: { id: 7 }, select: { id: true, smsCredits: true, smsLowBalanceThreshold: true } });
  assert.equal((await fetch(`${base}/8`)).status, 404);
  assert.equal((await fetch(`${base}/9`)).status, 503);
});
