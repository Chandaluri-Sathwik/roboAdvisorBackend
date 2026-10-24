
import AssetHistory from "../models/AssetHistory.js";
import {
  fetchStockHistory,
  fetchCommodityHistory,
  fetchBondYields as fetchBondYieldsFromProvider,
  fetchMutualFundHistory,
} from "../services/assetDataService.js";

export const saveHistory = async (records) => {
  const validRecords = records.filter((row) => {
    const date = new Date(row.date);

    return (
      row.assetType &&
      row.symbol &&
      row.source &&
      Number.isFinite(date.getTime()) &&
      (row.close != null || row.value != null)
    );
  });

  if (validRecords.length === 0) return 0;

  const operations = validRecords.map((row) => {
    const date = new Date(row.date);
    const observationKey = row.observationKey ?? "default";

    return {
      updateOne: {
        filter: {
           assetType: row.assetType,
           symbol: row.symbol,
           date: new Date(row.date),
           observationKey: row.observationKey ?? "default",
        },
        update: {
          $set: {
            ...row,
            date,
            observationKey,
          },
        },
        upsert: true,
      },
    };
  });

  await AssetHistory.bulkWrite(operations, { ordered: false });

  return validRecords.length;
};

const sendHistoryResponse = async (res, records) => {
  const savedCount = await saveHistory(records);

  return res.json({
    success: true,
    count: records.length,
    savedCount,
    data: records,
  });
};

// GET /api/assets/stocks/:symbol/history
export const getStockHistory = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { exchange = "nse", from, to } = req.query;

    if (!/^[a-zA-Z0-9&._-]+$/.test(symbol)) {
      return res.status(400).json({
        success: false,
        message: "Invalid stock symbol.",
      });
    }

    if (!["nse", "bse"].includes(String(exchange).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Exchange must be nse or bse.",
      });
    }

    const records = await fetchStockHistory({
      symbol,
      exchange: String(exchange).toLowerCase(),
      from,
      to,
    });

    return await sendHistoryResponse(res, records);
  } catch (error) {
    console.error("Stock history error:", error.message);

    return res.status(502).json({
      success: false,
      message: error.message || "Failed to fetch stock history.",
    });
  }
};

// GET /api/assets/commodities/:commodity/history
export const getCommodityHistory = async (req, res) => {
  try {
    const { commodity } = req.params;
    const { interval = "monthly" } = req.query;

    const records = await fetchCommodityHistory({
      commodity,
      interval,
    });

    return await sendHistoryResponse(res, records);
  } catch (error) {
    console.error("Commodity history error:", error.message);

    return res.status(502).json({
      success: false,
      message: error.message || "Failed to fetch commodity history.",
    });
  }
};

// GET /api/assets/bonds/yields
export const getBondYields = async (req, res) => {
  try {
    const records = await fetchBondYieldsFromProvider();

    return await sendHistoryResponse(res, records);
  } catch (error) {
    console.error("Bond yield error:", error.message);

    return res.status(502).json({
      success: false,
      message: error.message || "Failed to fetch bond yields.",
    });
  }
};

// GET /api/assets/mutual-funds/:schemeCode/history
export const getMutualFundHistory = async (req, res) => {
  try {
    const { schemeCode } = req.params;
    const records = await fetchMutualFundHistory({ schemeCode });

    return await sendHistoryResponse(res, records);
  } catch (error) {
    console.error("Mutual-fund history error:", error.message);

    return res.status(502).json({
      success: false,
      message: error.message || "Failed to fetch mutual-fund history.",
    });
  }
};
