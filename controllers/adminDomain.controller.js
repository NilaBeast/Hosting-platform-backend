const DomainPricing = require("../models/DomainPricing");

/* GET ALL */
exports.getDomainPricing = async (req, res) => {
  try {
    const pricing = await DomainPricing.findAll({
      order: [["tld", "ASC"]],
    });

    res.json(pricing);
  } catch (err) {
    res.status(500).json("Failed");
  }
};

/* UPDATE */
exports.updateDomainPricing = async (req, res) => {
  try {
    const { id, register_price, renew_price, transfer_price } = req.body;

    const domain = await DomainPricing.findByPk(id);

    if (!domain) return res.status(404).json("Not found");

    domain.register_price = register_price;
    domain.renew_price = renew_price;
    domain.transfer_price = transfer_price;

    // 🔥 LOCK THIS PRICE
    domain.is_custom = true;

    await domain.save();

    res.json({ message: "Updated & Locked" });
  } catch (err) {
    console.log(err);
    res.status(500).json("Update failed");
  }
};