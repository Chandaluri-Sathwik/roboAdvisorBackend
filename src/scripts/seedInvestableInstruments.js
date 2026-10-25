import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import AssetHistory from "../models/AssetHistory.js";
import InvestableInstrument from "../models/InvestableInstrument.js";
import { mutualFundUniverse, stockUniverse } from "../config/assetUniverse.js";
import { validateConfiguredFundMetadata } from "../services/fundDataValidation.js";

async function seedStock(symbol) {
  const observed = await AssetHistory.findOne({
    assetType: "stock",
    symbol,
    source: "TejHQ",
  }).sort({ date: -1 }).lean();
  if (!observed) {
    await InvestableInstrument.updateOne(
      { symbol, instrumentType: "stock" },
      { $set: { isVerified: false, isInvestable: false } },
    );
    console.warn(`! Skipping ${symbol}: no TejHQ history; run seed:assets first.`);
    return false;
  }
  await InvestableInstrument.findOneAndUpdate(
    { symbol, instrumentType: "stock" },
    {
      symbol,
      name: symbol,
      assetClass: "equity",
      instrumentType: "stock",
      currency: "INR",
      exchange: "NSE",
      isInvestable: true,
      isVerified: true,
      verificationSource: "Configured NSE equity universe with stored TejHQ NSE history",
      verifiedAt: new Date(),
      metadataNotes: "Educational candidate. Confirm current listing status, liquidity, costs, and suitability before investing.",
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  return true;
}

async function seedFund(fund) {
  const records = await AssetHistory.find({
    assetType: "mutualFund",
    symbol: String(fund.schemeCode),
    source: "MFapi.in",
  }).sort({ date: 1 }).lean();
  const metadata = validateConfiguredFundMetadata(fund, records);
  const assetClass = fund.assetClass === "gold" ? "commodity" : fund.assetClass === "cash_proxy" ? "debt" : fund.assetClass;
  await InvestableInstrument.findOneAndUpdate(
    { symbol: String(fund.schemeCode), instrumentType: "mutualFund" },
    {
      symbol: String(fund.schemeCode),
      name: metadata.schemeName,
      assetClass,
      instrumentType: "mutualFund",
      currency: "INR",
      schemeCode: String(fund.schemeCode),
      isInvestable: true,
      isVerified: true,
      verificationSource: "MFapi.in scheme identity, category, and Direct-Growth metadata",
      verifiedAt: new Date(),
      metadataNotes: `Fund house: ${metadata.fundHouse ?? "not supplied"}. Educational candidate; not a suitability endorsement.`,
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  return metadata.schemeName;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing from .env.");
  await connectDB();
  try {
    let stocksSeeded = 0;
    let failures = 0;
    for (const symbol of [...new Set(stockUniverse)]) {
      if (await seedStock(symbol)) stocksSeeded++;
      else failures++;
    }

    let fundsSeeded = 0;
    for (const fund of mutualFundUniverse) {
      try {
        const name = await seedFund(fund);
        fundsSeeded++;
        console.log(`✓ verified mutual fund candidate ${name} (${fund.schemeCode})`);
      } catch (error) {
        failures++;
        await InvestableInstrument.updateOne(
          { symbol: String(fund.schemeCode), instrumentType: "mutualFund" },
          { $set: { isVerified: false, isInvestable: false } },
        );
        console.error(`✗ mutual fund ${fund.schemeCode} was not cataloged: ${error.message}`);
      }
    }

    console.log(`Instrument catalog seed finished: ${stocksSeeded} equity stocks, ${fundsSeeded} verified mutual funds, ${failures} skipped/failed.`);
    console.log("Commodity price series and RBI yield observations remain references, not investable products.");
    if (failures > 0) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error("Instrument catalog seed failed:", error.message);
  process.exitCode = 1;
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});
