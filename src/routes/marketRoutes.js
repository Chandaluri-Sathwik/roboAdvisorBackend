import express from "express";
import {
  getLatestMutualFundNAV
} from "../controllers/marketController.js";

const router = express.Router();

router.get(
  "/mutual-funds/:schemeCode/latest",
  getLatestMutualFundNAV
);

export default router;