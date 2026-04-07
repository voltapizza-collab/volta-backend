import express from "express";
import cors from "cors";

import storesRoutes from "./routes/stores.js";
import partnersRoutes from "./routes/partners.js";
import adminRoutes from "./routes/admin.js";
import ingredientsRoutes from "./routes/ingredients.js";
import storeIngredientsRoutes from "./routes/storeIngredients.js";

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL,
  process.env.PUBLIC_FRONTEND_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : null,
].filter(Boolean);

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


app.get("/", (req, res) => {
  res.send("Volta Core running 🚀");
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
