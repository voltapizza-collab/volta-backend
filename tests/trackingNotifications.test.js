import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTrackingNotificationSettings,
  sendBoostPurchasedTrackingSms,
  sendIngredientDisabledTrackingSms,
  sendReservationCanceledTrackingSms,
  sendStoreStatusTrackingSms,
} from "../services/trackingNotifications.js";

const makeContext = (settings) => ({
  store: {
    id: 12,
    partnerId: 3,
    storeName: "Plaza Diario",
    partner: {
      id: 3,
      name: "Volta Partner",
      trackingNotificationSettings: settings,
    },
  },
  ingredient: {
    id: 7,
    name: "Pina",
  },
  stock: {
    storeId: 12,
    ingredientId: 7,
  },
});

test("tracking settings keep ingredient disabled on by default when services are missing", () => {
  const settings = normalizeTrackingNotificationSettings({
    enabled: true,
    recipientPhone: "612345678",
    contactPhoneConfirmed: true,
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.services.ingredientDisabled, true);
  assert.equal(settings.services.reservationCanceled, true);
  assert.equal(settings.services.boostPurchased, true);
});

test("ingredient disabled SMS skips when tracking is disabled", async () => {
  let reserved = false;
  const result = await sendIngredientDisabledTrackingSms(
    {},
    makeContext({
      enabled: false,
      recipientPhone: "612345678",
      contactPhoneConfirmed: true,
      services: { ingredientDisabled: true },
    }),
    {
      reserveSmsCreditForMessage: async () => {
        reserved = true;
      },
    }
  );

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "tracking_disabled");
  assert.equal(reserved, false);
});

test("ingredient disabled SMS reserves credit and sends the alert", async () => {
  const calls = [];
  const result = await sendIngredientDisabledTrackingSms(
    {},
    makeContext({
      enabled: true,
      recipientPhone: "612345678",
      contactPhoneConfirmed: true,
      services: { ingredientDisabled: true },
    }),
    {
      reserveSmsCreditForMessage: async (_prisma, payload) => {
        calls.push(["reserve", payload]);
        return { ok: true, ledgerId: 55 };
      },
      sendTelnyxSms: async (payload) => {
        calls.push(["send", payload]);
        return { ok: true, status: "queued", providerMessageId: "msg_1" };
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.ledgerId, 55);
  assert.equal(calls[0][0], "reserve");
  assert.equal(calls[0][1].partnerId, 3);
  assert.equal(calls[0][1].reference, "ingredient-disabled:12:7");
  assert.equal(calls[0][1].to, "+34612345678");
  assert.equal(calls[1][0], "send");
  assert.match(calls[1][1].text, /Pina fue desactivado en Plaza Diario/);
  assert.match(calls[1][1].text, /Momento: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\./);
  assert.deepEqual(calls[1][1].tags, [
    "tracking:ingredientDisabled",
    "partner:3",
    "store:12",
    "ingredient:7",
  ]);
});

test("store closed SMS reserves credit and sends the alert", async () => {
  const calls = [];
  const result = await sendStoreStatusTrackingSms(
    {},
    {
      store: {
        id: 12,
        partnerId: 3,
        storeName: "Plaza Diario",
        active: false,
        partner: {
          id: 3,
          name: "Volta Partner",
          trackingNotificationSettings: {
            enabled: true,
            recipientPhone: "612345678",
            contactPhoneConfirmed: true,
            services: { storeOpenClosed: true },
          },
        },
      },
    },
    {
      reserveSmsCreditForMessage: async (_prisma, payload) => {
        calls.push(["reserve", payload]);
        return { ok: true, ledgerId: 63 };
      },
      sendTelnyxSms: async (payload) => {
        calls.push(["send", payload]);
        return { ok: true, status: "queued", providerMessageId: "msg_store" };
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.ledgerId, 63);
  assert.equal(calls[0][1].reference, "store-status:12:closed");
  assert.equal(calls[0][1].to, "+34612345678");
  assert.match(calls[1][1].text, /Plaza Diario fue cerrada para pedidos/);
  assert.match(calls[1][1].text, /Momento: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\./);
  assert.deepEqual(calls[1][1].tags, [
    "tracking:storeOpenClosed",
    "partner:3",
    "store:12",
  ]);
});

test("ingredient disabled SMS refunds credit when provider send fails", async () => {
  const calls = [];
  const result = await sendIngredientDisabledTrackingSms(
    {},
    makeContext({
      enabled: true,
      recipientPhone: "612345678",
      contactPhoneConfirmed: true,
      services: { ingredientDisabled: true },
    }),
    {
      reserveSmsCreditForMessage: async () => ({ ok: true, ledgerId: 9 }),
      sendTelnyxSms: async () => ({
        ok: false,
        status: "failed",
        error: { title: "provider_down" },
      }),
      refundSmsCreditForMessage: async (_prisma, payload) => {
        calls.push(payload);
        return { ok: true };
      },
    }
  );

  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].partnerId, 3);
  assert.equal(calls[0].reference, "ingredient-disabled:12:7");
  assert.equal(calls[0].reason, "provider_down");
});

test("reservation canceled SMS reserves credit and sends the alert", async () => {
  const calls = [];
  const result = await sendReservationCanceledTrackingSms(
    {},
    {
      reservation: {
        id: 44,
        partnerId: 3,
        storeId: 12,
        customerName: "Luigi",
        partySize: 4,
        reservationDate: new Date("2026-06-01T00:00:00Z"),
        reservationTime: "20:30",
        store: {
          id: 12,
          partnerId: 3,
          storeName: "Plaza Diario",
          partner: {
            id: 3,
            name: "Volta Partner",
            trackingNotificationSettings: {
              enabled: true,
              recipientPhone: "612345678",
              contactPhoneConfirmed: true,
              services: { reservationCanceled: true },
            },
          },
        },
      },
    },
    {
      reserveSmsCreditForMessage: async (_prisma, payload) => {
        calls.push(["reserve", payload]);
        return { ok: true, ledgerId: 88 };
      },
      sendTelnyxSms: async (payload) => {
        calls.push(["send", payload]);
        return { ok: true, status: "queued", providerMessageId: "msg_2" };
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.ledgerId, 88);
  assert.equal(calls[0][1].reference, "reservation-canceled:44");
  assert.equal(calls[0][1].to, "+34612345678");
  assert.match(calls[1][1].text, /Reserva cancelada en Plaza Diario: Luigi/);
  assert.match(calls[1][1].text, /Momento: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\./);
  assert.deepEqual(calls[1][1].tags, [
    "tracking:reservationCanceled",
    "partner:3",
    "store:12",
    "reservation:44",
  ]);
});

test("boost purchased SMS reserves credit and sends the alert", async () => {
  const calls = [];
  const result = await sendBoostPurchasedTrackingSms(
    {},
    {
      sale: {
        id: 77,
        partnerId: 3,
        storeId: 12,
        code: "WEB-BOOST-77",
        customerData: { name: "Mario" },
        currency: "EUR",
        boostAmount: "2.50",
        boostTargetPosition: 1,
        boostQueueCredit: 3,
        store: {
          id: 12,
          partnerId: 3,
          storeName: "Plaza Diario",
          partner: {
            id: 3,
            name: "Volta Partner",
            trackingNotificationSettings: {
              enabled: true,
              recipientPhone: "612345678",
              contactPhoneConfirmed: true,
              services: { boostPurchased: true },
            },
          },
        },
      },
    },
    {
      reserveSmsCreditForMessage: async (_prisma, payload) => {
        calls.push(["reserve", payload]);
        return { ok: true, ledgerId: 91 };
      },
      sendTelnyxSms: async (payload) => {
        calls.push(["send", payload]);
        return { ok: true, status: "queued", providerMessageId: "msg_3" };
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.ledgerId, 91);
  assert.equal(calls[0][1].reference, "boost-purchased:77");
  assert.equal(calls[0][1].to, "+34612345678");
  assert.match(calls[1][1].text, /Boost comprado en Plaza Diario/);
  assert.match(calls[1][1].text, /WEB-BOOST-77/);
  assert.match(calls[1][1].text, /Momento: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\./);
  assert.deepEqual(calls[1][1].tags, [
    "tracking:boostPurchased",
    "partner:3",
    "store:12",
    "sale:77",
  ]);
});
