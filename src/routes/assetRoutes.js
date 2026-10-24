import express from "express";
import {
  getStockHistory,
  getCommodityHistory,
  getBondYields,
  getMutualFundHistory
} from "../controllers/assetController.js";

const router = express.Router();

router.get("/stocks/:symbol/history", getStockHistory);
router.get("/commodities/:commodity/history", getCommodityHistory);
router.get("/bonds/yields", getBondYields);
router.get("/mutual-funds/:schemeCode/history", getMutualFundHistory);

export default router;
