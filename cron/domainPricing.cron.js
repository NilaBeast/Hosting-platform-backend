const axios = require("axios");
const cron = require("node-cron");
const DomainPricing = require("../models/DomainPricing");

const BASE = "https://test.techzuno.com";

/* ===============================
   EXTRACT
================================ */
const extractPricing = (data) => {
  if (!data?.pricing) return [];

  return Object.entries(data.pricing).map(([tld, value]) => ({
    tld: "." + tld,
    register: value?.register?.["1"] || value?.register?.[1] || 0,
    renew: value?.renew?.["1"] || value?.renew?.[1] || 0,
    transfer: value?.transfer?.["1"] || value?.transfer?.[1] || 0,
    currency: data?.currency?.code || "INR",
  }));
};

/* ===============================
   SYNC (🔥 FIXED)
================================ */
const syncPricing = async () => {
  try {
    console.log("⏳ Syncing domain pricing...");

    const res = await axios.get(
      `${BASE}/api/registrars/wbeen/tld-pricing`
    );

    const pricing = extractPricing(res.data);

    for (const item of pricing) {
      const existing = await DomainPricing.findOne({
        where: { tld: item.tld },
      });

      if (!existing) {
        // 🔥 CREATE NEW
        await DomainPricing.create({
          tld: item.tld,

          register_price: Number(item.register),
          renew_price: Number(item.renew),
          transfer_price: Number(item.transfer),

          register_margin: 0,
          renew_margin: 0,
          transfer_margin: 0,

          currency: item.currency,
        });

        console.log("🆕 Created:", item.tld);
      } else {
        // 🔥 ONLY UPDATE BASE PRICE (DO NOT TOUCH MARGIN)
        existing.register_price = Number(item.register);
        existing.renew_price = Number(item.renew);
        existing.transfer_price = Number(item.transfer);
        existing.currency = item.currency;

        await existing.save();

        console.log("♻️ Updated:", item.tld);
      }
    }

    console.log("✅ Sync Done\n");
  } catch (err) {
    console.log("❌ Sync Error:", err.message);
  }
};

/* RUN */
cron.schedule("0 */6 * * *", syncPricing); // every 6 hours
syncPricing();

module.exports = syncPricing;