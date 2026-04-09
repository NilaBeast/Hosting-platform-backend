const axios = require("axios");
const cron = require("node-cron");
const DomainPricing = require("../models/DomainPricing");

const BASE = "https://test.techzuno.com";

/* ===============================
   CORRECT EXTRACTOR (WHMCS FIX)
================================ */
const extractPricing = (data) => {
  if (!data) return [];

  // ✅ WHMCS FORMAT (YOUR CASE)
  if (data.pricing && typeof data.pricing === "object") {
    return Object.entries(data.pricing).map(([tld, value]) => ({
      tld: "." + tld,

      register:
        value?.register?.["1"] ||
        value?.register?.[1] ||
        0,

      renew:
        value?.renew?.["1"] ||
        value?.renew?.[1] ||
        0,

      transfer:
        value?.transfer?.["1"] ||
        value?.transfer?.[1] ||
        0,

      currency: data?.currency?.code || "INR",
    }));
  }

  return [];
};

/* ===============================
   SYNC FUNCTION
================================ */
const syncPricing = async () => {
  try {
    console.log("\n⏳ Fetching TLD pricing...");

    const res = await axios.get(
      `${BASE}/api/registrars/wbeen/tld-pricing`
    );

    console.log("📦 RAW RECEIVED");

    const pricing = extractPricing(res.data);

    if (!pricing.length) {
      console.log("❌ No valid TLD pricing found\n");
      return;
    }

    console.log(`📊 Total TLDs: ${pricing.length}\n`);

    for (const item of pricing) {
      const [record, created] = await DomainPricing.upsert(
        {
          tld: item.tld,
          register_price: parseFloat(item.register),
          renew_price: parseFloat(item.renew),
          transfer_price: parseFloat(item.transfer),
          currency: item.currency,
        },
        { returning: true }
      );

      console.log(
        `${created ? "🆕 Created" : "♻️ Updated"} → ${item.tld} | ₹${item.register}`
      );
    }

    console.log("\n✅ Sync completed\n");
  } catch (err) {
    console.log(
      "❌ Pricing sync failed:",
      err.response?.data || err.message
    );
  }
};

/* ===============================
   TEST MODE (EVERY 15 SEC)
================================ */
cron.schedule("*/200 * * * * *", syncPricing);

/* RUN ON START */
syncPricing();

module.exports = syncPricing;