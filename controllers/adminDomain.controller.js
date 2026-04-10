const DomainPricing = require("../models/DomainPricing");

/* ===============================
   GET ALL
================================ */
exports.getDomainPricing = async (req, res) => {
  const data = await DomainPricing.findAll({
    order: [["tld", "ASC"]],
  });

  res.json(data);
};

/* ===============================
   🔥 UPDATE MARGINS (FIXED)
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

    // 🔥 IMPORTANT FIX: only update if provided
    if (register_margin !== undefined) {
      domain.register_margin = Number(register_margin);
    }

    if (renew_margin !== undefined) {
      domain.renew_margin = Number(renew_margin);
    }

    if (transfer_margin !== undefined) {
      domain.transfer_margin = Number(transfer_margin);
    }

    await domain.save();

    res.json({ message: "Margins updated" });
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed");
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