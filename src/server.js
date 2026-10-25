import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

import connectDB from "./config/db.js";
import marketRoutes from "./routes/marketRoutes.js";
import assetRoutes from "./routes/assetRoutes.js";
import planRoutes from "./routes/planRoutes.js";
import assistantRoutes from "./routes/assistantRoutes.js";
import marketAnalysisRoutes from "./routes/marketAnalysisRoutes.js";
import { errorHandler } from "./middleware/errors.js";
import { migrateLegacyPortfolios } from "./services/portfolioMigrationService.js";

dotenv.config();

export function createApp() {
  const app = express();

  app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173"
  }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (req, res) => {
    res.status(200).json({
      success: true,
      message: "Robo-advisor backend is running."
    });
  });

  app.use("/api/market", marketRoutes);
  app.use("/api/assets", assetRoutes);
  app.use("/api/v1", planRoutes);
  app.use("/api/v1/market-data", marketAnalysisRoutes);
  app.use(
    "/api/v1/assistant",
    rateLimit({
      windowMs: 60_000,
      limit: 12,
      standardHeaders: true,
      legacyHeaders: false,
      message: { detail: "Assistant request limit reached. Please wait before trying again." },
    }),
    assistantRoutes
  );
  app.use((req, res) => {
    res.status(404).json({ detail: "Route not found." });
  });
  app.use(errorHandler);
  return app;
}

export const startServer = async () => {
  try {
    await connectDB();
    const migratedPortfolios = await migrateLegacyPortfolios();
    if (migratedPortfolios > 0) {
      console.log(`Migrated ${migratedPortfolios} saved portfolio(s) to the three-class model.`);
    }
    const app = createApp();
    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  startServer();
}