import mongoose from "mongoose";

const marketDataSchema = new mongoose.Schema(
  {
    schemeCode: {
      type: String,
      required: true,
      unique: true
    },
    schemeName: {
      type: String,
      required: true
    },
    nav: {
      type: Number,
      required: true
    },
    navDate: {
      type: String,
      required: true
    },
    source: {
      type: String,
      default: "MFapi.in"
    },
    fetchedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

const MarketData = mongoose.model(
  "MarketData",
  marketDataSchema
);

export default MarketData;