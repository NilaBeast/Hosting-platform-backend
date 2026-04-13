const axios = require("axios");
const DomainPricing = require("../models/DomainPricing");

const BASE = "https://test.techzuno.com";

/* CHECK DOMAIN */
exports.checkDomain = async (req, res) => {
  try {
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({ error: "Domain required" });
    }

    const response = await axios.get(
      `${BASE}/api/registrars/wbeen/domains/${domain}/check`
    );

    const isAvailable = response.data?.available;

    let price = 0;
    let years = [1];
    let pricing_json = null;

    if (isAvailable) {
      const tld = "." + domain.split(".").pop();

      const pricing = await DomainPricing.findOne({
        where: { tld },
      });

      console.log("🔍 DB PRICING:", pricing?.toJSON());

      if (pricing) {
        /* 🔥 SAFE NUMBER PARSE */
        const base = parseFloat(pricing.register_price) || 0;
        const margin = parseFloat(pricing.register_margin) || 0;

        price = base + margin;

        console.log("💰 CALC:", { base, margin, final: price });

        /* ✅ ADVANCED PRICING */
        pricing_json = pricing.pricing_json || null;

        /* ✅ YEARS */
        if (pricing_json && typeof pricing_json === "object") {
          years = Object.keys(pricing_json)
            .map(Number)
            .filter((y) => !isNaN(y));
        }
      } else {
        console.log("❌ NO PRICING FOUND FOR TLD:", tld);
      }
    }

    res.json({
      domain,
      available: isAvailable,
      price,
      years,
      pricing_json,
    });
  } catch (err) {
    console.log("❌ ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to check domain" });
  }
};

/* REDIRECT TO BUY DOMAIN */
exports.buyDomain = async (req, res) => {
  try {
    const { domain } = req.query;

    if (!domain) {
      return res.status(400).json({ error: "Domain required" });
    }

    // 👉 WBeen direct cart URL (IMPORTANT)
    const buyUrl = `https://secure.wbeen.com/cart.php?a=add&domain=register&query=${domain}`;

    res.json({ url: buyUrl });
  } catch (err) {
    res.status(500).json({ error: "Failed to redirect" });
  }
};

exports.transferDomain = async (req, res) => {
  try {
    const { domain, authCode } = req.body;

    const response = await axios.post(
      `${BASE}/api/registrars/wbeen/domains/transfer`,
      {
        domain,
        authCode,
      }
    );

    res.json(response.data);
  } catch (err) {
    console.log(err.response?.data || err.message);
    res.status(500).json("Transfer failed");
  }
};