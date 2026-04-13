const DomainPricing = require("../models/DomainPricing");
const axios = require("axios");

const BASE = process.env.WBEEN_API_URL;

/* ===============================
   GET ALL (🔥 FIXED FINAL PRICE)
================================ */
exports.getDomainPricing = async (req, res) => {
  try {
    const data = await DomainPricing.findAll({
      order: [["tld", "ASC"]],
    });

    const result = data.map((d) => {
      const registerBase = Number(d.register_price || 0);
      const registerMargin = Number(d.register_margin || 0);

      const renewBase = Number(d.renew_price || 0);
      const renewMargin = Number(d.renew_margin || 0);

      const transferBase = Number(d.transfer_price || 0);
      const transferMargin = Number(d.transfer_margin || 0);

      return {
        ...d.toJSON(),

        /* 🔥 FINAL PRICES */
        final_register_price: registerBase + registerMargin,
        final_renew_price: renewBase + renewMargin,
        final_transfer_price: transferBase + transferMargin,
      };
    });

    res.json(result);
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed");
  }
};

/* ===============================
   🔥 UPDATE MARGINS (SAFE)
================================ */
exports.updateMargins = async (req, res) => {
  try {
    const {
      id,
      register_margin,
      renew_margin,
      transfer_margin,
    } = req.body;

    const domain = await DomainPricing.findByPk(id);
    if (!domain) return res.status(404).json("Not found");

    if (register_margin !== undefined) {
      domain.register_margin = Number(register_margin || 0);
    }

    if (renew_margin !== undefined) {
      domain.renew_margin = Number(renew_margin || 0);
    }

    if (transfer_margin !== undefined) {
      domain.transfer_margin = Number(transfer_margin || 0);
    }

    await domain.save();

    res.json({ message: "Margins updated" });
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed");
  }
};

/* ===============================
   🔥 SYNC WBEEN PRICE (IMPORTANT)
================================ */
exports.syncWbeenPrice = async (req, res) => {
  try {
    const { tld } = req.body;

    const cleanTld = tld.replace(".", "");

    const response = await axios.get(
      `${BASE}/api/registrars/wbeen/tlds/${cleanTld}`
    );

    const data = response.data;

    const domain = await DomainPricing.findOne({ where: { tld } });
    if (!domain) return res.status(404).json("Not found");

    /* 🔥 UPDATE BASE PRICES FROM WBEEN */
    domain.register_price = Number(data?.register || 0);
    domain.renew_price = Number(data?.renew || 0);
    domain.transfer_price = Number(data?.transfer || 0);

    await domain.save();

    res.json({ message: "Synced with WBEEN" });
  } catch (err) {
    console.log(err.response?.data || err.message);
    res.status(500).json("Sync failed");
  }
};

/* ===============================
   TAG
================================ */
exports.updateTag = async (req, res) => {
  const { id, tag } = req.body;

  const domain = await DomainPricing.findByPk(id);
  if (!domain) return res.status(404).json("Not found");

  domain.tag = tag;
  await domain.save();

  res.json({ message: "Tag updated" });
};

/* ===============================
   SPOTLIGHT (MAX 10)
================================ */
exports.toggleSpotlight = async (req, res) => {
  const { id } = req.body;

  const domain = await DomainPricing.findByPk(id);

  const count = await DomainPricing.count({
    where: { is_spotlight: true },
  });

  if (!domain.is_spotlight && count >= 10) {
    return res.status(400).json("Only 10 allowed");
  }

  domain.is_spotlight = !domain.is_spotlight;

  await domain.save();

  res.json({ message: "Updated" });
};

/* ===============================
   ADVANCED PRICING
================================ */
exports.updateAdvancedPricing = async (req, res) => {
  const { id, pricing } = req.body;

  const domain = await DomainPricing.findByPk(id);
  if (!domain) return res.status(404).json("Not found");

  domain.pricing_json = pricing;

  await domain.save();

  res.json({ message: "Saved" });
};