const Plan = require("../models/Plan");

/* ===============================
   GET PACKAGE PRICING
================================ */
exports.getPackagePricing = async (req, res) => {
  try {
    const plans = await Plan.findAll();

    res.json(plans);
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed");
  }
};

/* ===============================
   UPDATE PACKAGE PRICING
================================ */
exports.updatePackagePricing = async (req, res) => {
  try {
    const { planId, pricing } = req.body;

    const plan = await Plan.findByPk(planId);
    if (!plan) return res.status(404).json("Plan not found");

    plan.pricing_json = pricing;

    await plan.save();

    res.json({ message: "Pricing updated" });
  } catch (err) {
    console.log(err);
    res.status(500).json("Update failed");
  }
};