import express from "express";
import cors from "cors";

import storesRoutes from "./routes/stores.js";
import partnersRoutes from "./routes/partners.js";
import adminRoutes from "./routes/admin.js";
import ingredientsRoutes from "./routes/ingredients.js";
import storeIngredientsRoutes from "./routes/storeIngredients.js";

const app = express();

// middlewares
app.use(express.json());

app.use(cors({
  origin: ["http://localhost:3000"],
  credentials: true
}));

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