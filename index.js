import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
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
import basesPizzasRoutes from "./routes/basesPizzas.js";
import ingredientExtrasRoutes from "./routes/ingredientExtras.js";
import stockRoutes from "./routes/stock.js";
import storeHoursRoutes from "./routes/storeHours.js";
import customersRoutes from "./routes/customers.js";
import couponsRoutes from "./routes/coupons.js";
import promosRoutes from "./routes/promos.js";
import telnyxWebhooksRoutes from "./routes/telnyxWebhooks.js";
import smsCreditsRoutes from "./routes/smsCredits.js";
import { validateTelnyxEnv } from "./services/telnyx.js";

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
const telnyxEnvStatus = validateTelnyxEnv({ requireWebhookPublicKey: true });
if (!telnyxEnvStatus.enabled) {
  console.warn("[telnyx] Missing env vars:", telnyxEnvStatus.missing.join(", "));
}
telnyxEnvStatus.warnings.forEach((warning) => console.warn("[telnyx]", warning));

const prisma = new PrismaClient();
const storesRouter = storesRoutes(prisma);
const stockRouter = stockRoutes(prisma);
const storeHoursRouter = storeHoursRoutes(prisma);
const customersRouter = customersRoutes(prisma);
const couponsRouter = couponsRoutes(prisma);
const promosRouter = promosRoutes(prisma);
const telnyxWebhooksRouter = telnyxWebhooksRoutes(prisma);
const smsCreditsRouter = smsCreditsRoutes(prisma);

const envOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  "http://localhost:3000",
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

// middlewares
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  },
}));

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
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
app.use("/api/menuDisponible", menuDisponibleRoutes(prisma));
app.use("/api/bases-pizzas", basesPizzasRoutes(prisma));
app.use("/api/coupons", couponsRouter);
app.use("/api/promos", promosRouter);
app.use("/api/sms-credits", smsCreditsRouter);
app.use("/api/webhooks", telnyxWebhooksRouter);


app.get("/", (req, res) => {
  res.send("Volta Core running 🚀");
});

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on("error", (error) => {
  console.error("[server] listen error:", error);
  process.exitCode = 1;
});
