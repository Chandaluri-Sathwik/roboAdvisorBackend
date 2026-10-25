import express from "express";
import {
  getFundClassAnalysis,
  getHistoricalSeriesAnalysis,
  getMarketDataCatalog,
  getMarketDataQuality,
  getUniverseAnalysis,
} from "../controllers/marketAnalysisController.js";
import { asyncHandler } from "../middleware/errors.js";

const router = express.Router();

router.get("/catalog", getMarketDataCatalog);
router.get("/quality", asyncHandler(getMarketDataQuality));
router.get("/fund-class-analysis", asyncHandler(getFundClassAnalysis));
router.get("/universe-analysis", asyncHandler(getUniverseAnalysis));
router.get(
  "/series/:assetType/:symbol/analysis",
  asyncHandler(getHistoricalSeriesAnalysis),
);

export default router;
