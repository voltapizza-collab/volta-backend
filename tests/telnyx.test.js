import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import axios from "axios";
import telnyxWebhooksRoutes from "../routes/telnyxWebhooks.js";
import {
  normalizeE164Phone,
  sendTelnyxSms,
  validateTelnyxEnv,
} from "../services/telnyx.js";
import {
  creditsFromAmount,
  rechargeSmsCredits,
  reserveSmsCreditForMessage,
} from "../services/smsCredits.js";

const TELNYX_ENV_KEYS = [
  "TELNYX_API_KEY",
  "TELNYX_MESSAGING_PROFILE_ID",
  "TELNYX_SENDER_ID",
  "TELNYX_WEBHOOK_URL",
  "TELNYX_WEBHOOK_PUBLIC_KEY",
  "TELNYX_SKIP_WEBHOOK_VERIFY",
];

const snapshotEnv = () =>
  Object.fromEntries(TELNYX_ENV_KEYS.map((key) => [key, process.env[key]]));

const restoreEnv = (snapshot) => {
  TELNYX_ENV_KEYS.forEach((key) => {
    if (snapshot[key] == null) delete process.env[key];
    else process.env[key] = snapshot[key];
  });
};

const setTelnyxEnv = () => {
  process.env.TELNYX_API_KEY = "test_api_key";
  process.env.TELNYX_MESSAGING_PROFILE_ID = "00000000-0000-0000-0000-000000000000";
  process.env.TELNYX_SENDER_ID = "PizzaOnline";
  process.env.TELNYX_WEBHOOK_URL = "https://example.test/api/webhooks/telnyx";
  process.env.TELNYX_WEBHOOK_PUBLIC_KEY = Buffer.alloc(32).toString("base64");
};

const makeSmsCreditPrismaMock = (initialCredits = 0) => {
  const state = {
    partner: {
      id: 1,
      name: "Partner",
      smsCredits: initialCredits,
      smsRecharged: initialCredits,
      smsConsumed: 0,
      smsLowBalanceThreshold: 50,
    },
    ledger: [],
  };

  const applyNumberOps = (data = {}) => {
    Object.entries(data).forEach(([field, operation]) => {
      if (operation && typeof operation === "object" && "increment" in operation) {
        state.partner[field] += operation.increment;
      } else if (operation && typeof operation === "object" && "decrement" in operation) {
        state.partner[field] -= operation.decrement;
      } else {
        state.partner[field] = operation;
      }
    });
  };

  const tx = {
    partner: {
      findUnique: async ({ where }) => (where.id === state.partner.id ? { ...state.partner } : null),
      update: async ({ where, data }) => {
        assert.equal(where.id, state.partner.id);
        applyNumberOps(data);
        return { ...state.partner };
      },
      updateMany: async ({ where, data }) => {
        if (where.id !== state.partner.id || state.partner.smsCredits < (where.smsCredits?.gte || 0)) {
          return { count: 0 };
        }
        applyNumberOps(data);
        return { count: 1 };
      },
    },
    smsCreditLedger: {
      create: async ({ data }) => {
        const row = { id: state.ledger.length + 1, ...data };
        state.ledger.push(row);
        return row;
      },
    },
  };

  return {
    ...tx,
    state,
    $transaction: async (worker) => worker(tx),
  };
};

test("validateTelnyxEnv reports missing required vars without secret values", () => {
  const env = snapshotEnv();
  TELNYX_ENV_KEYS.forEach((key) => delete process.env[key]);

  try {
    const status = validateTelnyxEnv({ requireWebhookPublicKey: true });

    assert.equal(status.enabled, false);
    assert.deepEqual(status.missing, [
      "TELNYX_API_KEY",
      "TELNYX_MESSAGING_PROFILE_ID",
      "TELNYX_SENDER_ID",
      "TELNYX_WEBHOOK_PUBLIC_KEY",
    ]);
  } finally {
    restoreEnv(env);
  }
});

test("normalizeE164Phone rejects invalid recipients", () => {
  assert.equal(normalizeE164Phone("not-a-phone"), null);
  assert.equal(normalizeE164Phone("612345678"), "+34612345678");
  assert.equal(normalizeE164Phone("+34612345678"), "+34612345678");
});

test("SMS credits quote EUR 10 as 12500 messages", () => {
  assert.equal(creditsFromAmount(10), 12500);
  assert.equal(creditsFromAmount("10,00"), 12500);
});

test("rechargeSmsCredits increments balance and writes ledger", async () => {
  const prisma = makeSmsCreditPrismaMock(0);

  const result = await rechargeSmsCredits(prisma, {
    partnerId: 1,
    amount: 10,
    reference: "test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.credits, 12500);
  assert.equal(result.balance.smsCredits, 12500);
  assert.equal(prisma.state.ledger[0].type, "RECHARGE");
  assert.equal(prisma.state.ledger[0].balanceAfter, 12500);
});

test("reserveSmsCreditForMessage rejects empty balances before send", async () => {
  const prisma = makeSmsCreditPrismaMock(0);

  const result = await reserveSmsCreditForMessage(prisma, {
    partnerId: 1,
    couponCode: "VOL-PFABC123",
    customerId: 7,
    to: "+34612345678",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "insufficient_sms_credits");
  assert.equal(prisma.state.ledger.length, 0);
});

test("sendTelnyxSms skips safely when env vars are missing", async () => {
  const env = snapshotEnv();
  TELNYX_ENV_KEYS.forEach((key) => delete process.env[key]);

  try {
    const result = await sendTelnyxSms({ to: "+34612345678", text: "Test" });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.error.title, "telnyx_not_configured");
    assert.ok(result.error.missing.includes("TELNYX_API_KEY"));
  } finally {
    restoreEnv(env);
  }
});

test("sendTelnyxSms rejects invalid recipient phone format before Telnyx call", async () => {
  const env = snapshotEnv();
  const originalPost = axios.post;
  setTelnyxEnv();
  let called = false;
  axios.post = async () => {
    called = true;
    return {};
  };

  try {
    const result = await sendTelnyxSms({ to: "bad-phone", text: "Test" });

    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(result.error.title, "invalid_phone");
    assert.equal(called, false);
  } finally {
    axios.post = originalPost;
    restoreEnv(env);
  }
});

test("sendTelnyxSms posts expected Telnyx v2 message payload", async () => {
  const env = snapshotEnv();
  const originalPost = axios.post;
  setTelnyxEnv();

  let captured = null;
  axios.post = async (url, payload, options) => {
    captured = { url, payload, options };
    return {
      data: {
        data: {
          id: "msg_test",
          to: [{ status: "queued" }],
          parts: 1,
          cost: null,
          received_at: "2026-04-30T00:00:00Z",
        },
      },
    };
  };

  try {
    const result = await sendTelnyxSms({
      to: "612345678",
      text: "PizzaOnline: Your private pizza offer is ready: 10% off. Use code VOL-PFABC123. Reply STOP to opt out.",
      tags: ["coupon:VOL-PFABC123"],
    });

    assert.equal(result.ok, true);
    assert.equal(captured.url, "https://api.telnyx.com/v2/messages");
    assert.equal(captured.payload.from, "PizzaOnline");
    assert.equal(captured.payload.to, "+34612345678");
    assert.equal(captured.payload.messaging_profile_id, process.env.TELNYX_MESSAGING_PROFILE_ID);
    assert.deepEqual(captured.payload.tags, ["coupon:VOL-PFABC123"]);
    assert.equal(captured.options.proxy, false);
    assert.match(captured.options.headers.Authorization, /^Bearer /);
  } finally {
    axios.post = originalPost;
    restoreEnv(env);
  }
});

test("sendTelnyxSms returns failed status on Telnyx API error", async () => {
  const env = snapshotEnv();
  const originalPost = axios.post;
  setTelnyxEnv();

  axios.post = async () => {
    const error = new Error("request failed");
    error.response = {
      status: 422,
      data: { errors: [{ code: "10015", title: "Invalid messaging profile" }] },
    };
    throw error;
  };

  try {
    const result = await sendTelnyxSms({ to: "+34612345678", text: "Test" });

    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(result.error.statusCode, 422);
    assert.equal(result.error.title, "Invalid messaging profile");
  } finally {
    axios.post = originalPost;
    restoreEnv(env);
  }
});

const listen = async (app) =>
  new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

test("Telnyx webhook accepts status event and updates coupon message metadata", async () => {
  const env = snapshotEnv();
  process.env.TELNYX_SKIP_WEBHOOK_VERIFY = "true";

  let updatedMeta = null;
  const prisma = {
    coupon: {
      findUnique: async () => ({ id: 1, meta: { message: { status: "queued" } } }),
      update: async ({ data }) => {
        updatedMeta = data.meta;
        return {};
      },
    },
    customer: {
      updateMany: async () => ({ count: 0 }),
    },
  };
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  app.use("/api/webhooks", telnyxWebhooksRoutes(prisma));
  const server = await listen(app);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/webhooks/telnyx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          id: "event_test",
          event_type: "message.finalized",
          occurred_at: "2026-04-30T00:00:00Z",
          payload: {
            id: "msg_test",
            tags: ["coupon:VOL-PFABC123"],
            to: [{ status: "delivered", phone_number: "+34612345678" }],
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(updatedMeta.messageStatus, "delivered");
    assert.equal(updatedMeta.message.providerMessageId, "msg_test");
  } finally {
    server.close();
    restoreEnv(env);
  }
});

test("Telnyx webhook handles STOP opt-out by restricting matching customer", async () => {
  const env = snapshotEnv();
  process.env.TELNYX_SKIP_WEBHOOK_VERIFY = "true";

  let restrictionUpdate = null;
  const prisma = {
    coupon: {
      findUnique: async () => null,
      update: async () => ({}),
    },
    customer: {
      updateMany: async (query) => {
        restrictionUpdate = query;
        return { count: 1 };
      },
    },
  };
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  app.use("/api/webhooks", telnyxWebhooksRoutes(prisma));
  const server = await listen(app);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/webhooks/telnyx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          event_type: "message.received",
          payload: {
            text: "STOP",
            from: { phone_number: "+34612345678" },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(restrictionUpdate.data.isRestricted, true);
    assert.equal(restrictionUpdate.data.restrictionReason, "SMS_STOP");
  } finally {
    server.close();
    restoreEnv(env);
  }
});

test("Telnyx webhook rejects invalid signature", async () => {
  const env = snapshotEnv();
  delete process.env.TELNYX_SKIP_WEBHOOK_VERIFY;
  process.env.TELNYX_WEBHOOK_PUBLIC_KEY = Buffer.alloc(32).toString("base64");

  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  app.use("/api/webhooks", telnyxWebhooksRoutes({
    coupon: {},
    customer: {},
  }));
  const server = await listen(app);

  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/webhooks/telnyx`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "telnyx-signature-ed25519": "invalid",
        "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({ data: { event_type: "message.finalized" } }),
    });

    assert.equal(response.status, 403);
  } finally {
    server.close();
    restoreEnv(env);
  }
});
