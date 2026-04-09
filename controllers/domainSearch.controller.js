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

    if (isAvailable) {
      const tld = "." + domain.split(".").pop();

      const pricing = await DomainPricing.findOne({
        where: { tld },
      });

      price = pricing?.register_price || 0;
    }

    res.json({
      domain,
      available: isAvailable,
      price,
    });
  } catch (err) {
    console.log(err.response?.data || err.message);
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