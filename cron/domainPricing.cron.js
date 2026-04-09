const axios = require("axios");
const cron = require("node-cron");
const DomainPricing = require("../models/DomainPricing");

const BASE = "https://test.techzuno.com";

/* ===============================
   EXTRACT PRICING
================================ */
const extractPricing = (data) => {
  if (!data) return [];

  if (data.pricing && typeof data.pricing === "object") {
    return Object.entries(data.pricing).map(([tld, value]) => ({
      tld: "." + tld,
      register: value?.register?.["1"] || value?.register?.[1] || 0,
      renew: value?.renew?.["1"] || value?.renew?.[1] || 0,
      transfer: value?.transfer?.["1"] || value?.transfer?.[1] || 0,
      currency: data?.currency?.code || "INR",
    }));
  }

  return [];
};

/* ===============================
   SYNC FUNCTION (🔥 FIXED)
================================ */
const syncPricing = async () => {
  try {
    console.log("\n⏳ Fetching TLD pricing...");

    const res = await axios.get(
      `${BASE}/api/registrars/wbeen/tld-pricing`
    );

    const pricing = extractPricing(res.data);

    if (!pricing.length) {
      console.log("❌ No valid pricing\n");
      return;
    }

    for (const item of pricing) {
      const existing = await DomainPricing.findOne({
        where: { tld: item.tld },
      });

      /* ===============================
         NEW ENTRY
      ============================== */
      if (!existing) {
        await DomainPricing.create({
          tld: item.tld,
          register_price: parseFloat(item.register),
          renew_price: parseFloat(item.renew),
          transfer_price: parseFloat(item.transfer),
          currency: item.currency,
        });

        console.log(`🆕 Created → ${item.tld}`);
      }

      /* ===============================
         UPDATE ONLY IF NOT CUSTOM
      ============================== */
      else {
        if (!existing.is_custom) {
          existing.register_price = parseFloat(item.register);
          existing.renew_price = parseFloat(item.renew);
          existing.transfer_price = parseFloat(item.transfer);
          existing.currency = item.currency;

          await existing.save();

          console.log(`♻️ Updated → ${item.tld}`);
        } else {
          console.log(`🔒 Skipped (custom) → ${item.tld}`);
        }
      }
    }

    console.log("\n✅ Sync completed\n");
  } catch (err) {
    console.log("❌ Sync failed:", err.response?.data || err.message);
  }
};

/* TEST CRON */
cron.schedule("*/200 * * * * *", syncPricing);

/* RUN ON START */
syncPricing();

module.exports = syncPricing;