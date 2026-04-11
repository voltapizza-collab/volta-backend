import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

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

const app = express();
const prisma = new PrismaClient();

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
app.use(express.json());

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
app.use("/stores", storesRoutes);
app.use("/partners", partnersRoutes);
app.use("/admin", adminRoutes);
app.use("/ingredients", ingredientsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api", partnerCategoriesRoutes(prisma));
app.use("/api/pizzas", pizzasRoutes(prisma));
app.use("/api/ingredient-extras", ingredientExtrasRoutes(prisma));
app.use("/api/menuDisponible", menuDisponibleRoutes(prisma));
app.use("/api/bases-pizzas", basesPizzasRoutes(prisma));


app.get("/", (req, res) => {
  res.send("Volta Core running 🚀");
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
