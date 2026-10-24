import axios from "axios";
import MarketData from "../models/MarketData.js";

export const getLatestMutualFundNAV = async (req, res) => {
  try {
    const { schemeCode } = req.params;

    // Basic validation
    if (!/^\d+$/.test(schemeCode)) {
      return res.status(400).json({
        success: false,
        message: "Scheme code must contain only digits."
      });
    }

    // Call the external MFapi.in endpoint
    const apiResponse = await axios.get(
      `https://api.mfapi.in/mf/${schemeCode}/latest`,
      { timeout: 10000 }
    );

    const data = apiResponse.data;

    if (
      !data ||
      !Array.isArray(data.data) ||
      data.data.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "No NAV data found for this scheme."
      });
    }

    const latest = data.data[0];
    const nav = Number(latest.nav);

    if (!Number.isFinite(nav)) {
      return res.status(502).json({
        success: false,
        message: "The market data provider returned an invalid NAV."
      });
    }

    // Save or update the scheme's latest NAV in MongoDB
    const savedData = await MarketData.findOneAndUpdate(
      { schemeCode },
      {
        schemeCode,
        schemeName: data.meta?.scheme_name || "Unknown scheme",
        nav,
        navDate: latest.date,
        source: "MFapi.in",
        fetchedAt: new Date()
      },
      {
        new: true,
        upsert: true,
        runValidators: true
      }
    );

    // Return a consistent response to the frontend
    return res.status(200).json({
      success: true,
      data: {
        schemeCode: savedData.schemeCode,
        schemeName: savedData.schemeName,
        nav: savedData.nav,
        navDate: savedData.navDate,
        source: savedData.source,
        fetchedAt: savedData.fetchedAt
      }
    });
  } catch (error) {
    console.error("Market data error:", error.message);

    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        message: "The requested mutual fund scheme was not found."
      });
    }

    if (error.response || error.code === "ECONNABORTED") {
      return res.status(502).json({
        success: false,
        message: "Unable to retrieve market data from the provider."
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve or save market data."
    });
  }
};