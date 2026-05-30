import test from "node:test";
import assert from "node:assert/strict";
import { buildAlert, formatAlertTimestampES } from "../routes/trackingAlerts.js";

test("tracking alerts expose a visible timestamp in the message and meta", () => {
  const alert = buildAlert({
    id: "store-status-12",
    type: "store_open_closed",
    serviceId: "storeOpenClosed",
    severity: "warning",
    title: "Tienda cerrada: Plaza Diario",
    message: "Plaza Diario no esta aceptando pedidos ahora mismo.",
    occurredAt: "2026-05-30T08:15:00.000Z",
    settings: {
      enabled: true,
      services: { storeOpenClosed: true },
    },
  });

  assert.match(alert.timestampLabel, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  assert.match(alert.message, /Momento: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\.$/);
  assert.equal(alert.meta.timestampLabel, alert.timestampLabel);
  assert.equal(alert.enabled, true);
});

test("tracking alert timestamp formatter falls back safely for bad dates", () => {
  assert.match(formatAlertTimestampES("bad-date"), /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});
