
import mongoose from "mongoose";

const assetHistorySchema = new mongoose.Schema(
  {
    // Identifies the investment-data category.
    assetType: {
      type: String,
      enum: ["stock", "commodity", "bond", "mutualFund"],
      required: true,
    },

    // Stock symbol, commodity symbol, or mutual-fund scheme code.
    symbol: {
      type: String,
      required: true,
    },

    date: {
      type: Date,
      required: true,
    },

    // "default" for ordinary assets; RBI reporting dimensions for bond data.
    observationKey: {
      type: String,
      default: "default",
      required: true,
    },

    open: Number,
    high: Number,
    low: Number,
    close: Number,
    volume: Number,

    // Commodity price, bond yield, or mutual-fund NAV.
    value: Number,

    currency: {
      type: String,
      default: "INR",
    },

    source: {
      type: String,
      required: true,
    },

    rawData: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

// One document per asset, date, and observation identity.
assetHistorySchema.index(
  {
    assetType: 1,
    symbol: 1,
    date: 1,
    observationKey: 1,
  },
  { unique: true }
);

export default mongoose.model("AssetHistory", assetHistorySchema);
