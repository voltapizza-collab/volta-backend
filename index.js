import express from "express";
import cors from "cors";

import storesRoutes from "./routes/stores.js";
import partnersRoutes from "./routes/partners.js";
import adminRoutes from "./routes/admin.js";
const app = express();

// middlewares
app.use(express.json());

app.use(cors({
  origin: ["http://localhost:3000"],
  credentials: true
}));

// routes
app.use("/stores", storesRoutes);
app.use("/partners", partnersRoutes);
app.use("/admin", adminRoutes);

// test route
app.get("/", (req, res) => {
  res.send("Volta Core running 🚀");
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});