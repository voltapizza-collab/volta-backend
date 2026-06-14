import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import storesRoutes from "./routes/stores.js";
import partnersRoutes from "./routes/partners.js";
import adminRoutes from "./routes/admin.js";
import ingredientsRoutes from "./routes/ingredients.js";
import storeIngredientsRoutes from "./routes/storeIngredients.js";
import categoriesRoutes from "./routes/categories.js";
import partnerCategoriesRoutes from "./routes/partnerCategories.js";
import pizzasRoutes from "./routes/pizzas.js";
import menuDisponibleRoutes from "./routes/menuDisponible.js";
import ingredientExtrasRoutes from "./routes/ingredientExtras.js";
import ingredientCategoryUsesRoutes from "./routes/ingredientCategoryUses.js";
import stockRoutes from "./routes/stock.js";
import storeHoursRoutes from "./routes/storeHours.js";
import customersRoutes from "./routes/customers.js";
import couponsRoutes from "./routes/coupons.js";
import communicationsRoutes from "./routes/communications.js";
import promosRoutes from "./routes/promos.js";
import directDiscountsRoutes from "./routes/directDiscounts.js";
import incentivesRoutes from "./routes/incentives.js";
import gamesRoutes from "./routes/games.js";
import reservationsRoutes from "./routes/reservations.js";
import scheduledOrdersRoutes from "./routes/scheduledOrders.js";
import telnyxWebhooksRoutes from "./routes/telnyxWebhooks.js";
import smsCreditsRoutes from "./routes/smsCredits.js";
import myordersRoutes from "./routes/myorders.js";
import billingRoutes from "./routes/billing.js";
import boostSettingsRoutes from "./routes/boostSettings.js";
import checkoutRoutes from "./routes/checkout.js";
import presenceRoutes from "./routes/presence.js";
import salesRoutes from "./routes/sales.js";
import trackingAlertsRoutes from "./routes/trackingAlerts.js";
import productReviewsRoutes from "./routes/productReviews.js";
import onboardingRoutes from "./routes/onboarding.js";
import { startProductReviewWorker } from "./services/productReviews.js";
import { validateTelnyxEnv } from "./services/telnyx.js";
import prisma, { withRequestMetrics } from "./services/prisma.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, ".env");

if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  envLines.forEach((line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) return;

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const normalizedValue = rawValue.replace(/^"(.*)"$/, "$1");

    if (!(key in process.env)) {
      process.env[key] = normalizedValue;
    }
  });
}

const app = express();
const hostRedirects = {
  "juego.mycrushpizza.com": "https://voltapizza.com/mycrushpizza/coupons",
};

app.use(withRequestMetrics);

app.use((req, res, next) => {
  const hostname = String(req.hostname || "").toLowerCase();
  const destination = hostRedirects[hostname];

  if (destination) {
    const queryString = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";
    return res.redirect(301, `${destination}${queryString}`);
  }

  return next();
});

const telnyxEnvStatus = validateTelnyxEnv({ requireWebhookPublicKey: true });
if (!telnyxEnvStatus.enabled) {
  console.warn("[telnyx] Missing env vars:", telnyxEnvStatus.missing.join(", "));
}
telnyxEnvStatus.warnings.forEach((warning) => console.warn("[telnyx]", warning));

const storesRouter = storesRoutes(prisma);
const stockRouter = stockRoutes(prisma);
const storeHoursRouter = storeHoursRoutes(prisma);
const customersRouter = customersRoutes(prisma);
const couponsRouter = couponsRoutes(prisma);
const communicationsRouter = communicationsRoutes(prisma);
const promosRouter = promosRoutes(prisma);
const directDiscountsRouter = directDiscountsRoutes(prisma);
const incentivesRouter = incentivesRoutes(prisma);
const gamesRouter = gamesRoutes(prisma);
const reservationsRouter = reservationsRoutes(prisma);
const scheduledOrdersRouter = scheduledOrdersRoutes(prisma);
const telnyxWebhooksRouter = telnyxWebhooksRoutes(prisma);
const smsCreditsRouter = smsCreditsRoutes(prisma);
const myordersRouter = myordersRoutes(prisma);
const billingRouter = billingRoutes(prisma);
const boostSettingsRouter = boostSettingsRoutes(prisma);
const checkoutRouter = checkoutRoutes(prisma);
const presenceRouter = presenceRoutes();
const salesRouter = salesRoutes(prisma);
const trackingAlertsRouter = trackingAlertsRoutes(prisma);
const productReviewsRouter = productReviewsRoutes(prisma);
const onboardingRouter = onboardingRoutes(prisma);

const envOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3010",
  "http://127.0.0.1:3010",
  "https://voltapizza.com",
  "https://www.voltapizza.com",
  "https://api.voltapizza.com",
  "https://volta-storefront-production.up.railway.app",
  process.env.FRONTEND_URL,
  process.env.PUBLIC_FRONTEND_URL,
  process.env.APP_URL,
  process.env.STOREFRONT_URL,
  process.env.RAILWAY_STATIC_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : null,
  ...envOrigins,
]
  .filter(Boolean)
  .filter((origin, index, arr) => arr.indexOf(origin) === index);

const isAllowedDevOrigin = (origin = "") => {
  if (process.env.NODE_ENV === "production") return false;

  try {
    const url = new URL(origin);
    return (
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      ["3000", "3010", "5173"].includes(url.port)
    );
  } catch {
    return false;
  }
};

// middlewares
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  },
}));

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || isAllowedDevOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);

app.use("/stores/:storeId/ingredients", storeIngredientsRoutes);
app.use("/api/stores/:storeId/ingredients", storeIngredientsRoutes);
app.use("/stores", storesRouter);
app.use("/api/stores", storesRouter);
app.use("/partners", partnersRoutes);
app.use("/admin", adminRoutes);
app.use("/ingredients", ingredientsRoutes);
app.use("/customers", customersRouter);
app.use("/api/customers", customersRouter);
app.use("/stock", stockRouter);
app.use("/api/stock", stockRouter);
app.use("/store-hours", storeHoursRouter);
app.use("/api/store-hours", storeHoursRouter);
app.use("/api/categories", categoriesRoutes);
app.use("/api", partnerCategoriesRoutes(prisma));
app.use("/api/pizzas", pizzasRoutes(prisma));
app.use("/api/ingredient-extras", ingredientExtrasRoutes(prisma));
app.use("/api/ingredient-category-uses", ingredientCategoryUsesRoutes(prisma));
app.use("/api/menuDisponible", menuDisponibleRoutes(prisma));
app.use("/api/coupons", couponsRouter);
app.use("/api/communications", communicationsRouter);
app.use("/api/promos", promosRouter);
app.use("/api/direct-discounts", directDiscountsRouter);
app.use("/api/incentives", incentivesRouter);
app.use("/api/games", gamesRouter);
app.use("/api/reservations", reservationsRouter);
app.use("/api/scheduled-orders", scheduledOrdersRouter);
app.use("/api/sms-credits", smsCreditsRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/presence", presenceRouter);
app.use("/api/myorders", myordersRouter);
app.use("/api/sales", salesRouter);
app.use("/api/tracking-alerts", trackingAlertsRouter);
app.use("/api/product-reviews", productReviewsRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/billing", billingRouter);
app.use("/api/boost-settings", boostSettingsRouter);
app.use("/api/webhooks", telnyxWebhooksRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "volta-backend", checkedAt: new Date().toISOString() });
});

app.get("/api/system/status", (_req, res) => {
  const telnyx = validateTelnyxEnv({ requireWebhookPublicKey: true });

  res.json({
    ok: true,
    service: "volta-backend",
    checkedAt: new Date().toISOString(),
    telnyx,
  });
});

const configuredFrontendUrl = process.env.PUBLIC_FRONTEND_URL?.trim();
const publicBackofficeUrl =
  process.env.BACKOFFICE_URL?.trim() ||
  (configuredFrontendUrl && !configuredFrontendUrl.includes("api.voltapizza.com")
    ? `${configuredFrontendUrl.replace(/\/$/, "")}/Backoffice`
    : "https://voltapizza.com/Backoffice");

app.get(["/Backoffice", "/backoffice"], (req, res) => {
  const queryString = req.originalUrl.includes("?")
    ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
    : "";
  res.redirect(302, `${publicBackofficeUrl}${queryString}`);
});


app.get("/", (req, res) => {
  res.send("Volta Core running 🚀");
});

const PORT = process.env.PORT || 8080;
let productReviewWorker = null;
let startupFailed = false;

const server = app.listen(PORT, () => {
  setImmediate(() => {
    if (startupFailed) return;

    productReviewWorker = startProductReviewWorker(prisma);
    console.log(`Server running on port ${PORT}`);
  });
});

server.on("error", async (error) => {
  startupFailed = true;
  console.error("[server] listen error:", error);
  productReviewWorker?.stop();
  await prisma.$disconnect().catch((disconnectError) => {
    console.error("[server] prisma disconnect error:", disconnectError);
  });
  process.exit(1);
});
