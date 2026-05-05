const Order = require("../models/Order");
const Plan = require("../models/Plan");
const User = require("../models/User");
const DomainPricing = require("../models/DomainPricing");

const Product = require("../models/Product"); // 🔥 ADD THIS
const { handleOrderSuccess } = require("../services/orderSuccess.service");
/* ===============================
   CREATE ORDER (ADMIN)
================================ */
exports.createOrder = async (req, res) => {
  try {
    const { user_id, product_id, domain, billing_cycle } = req.body;

    const product = await Product.findByPk(product_id);
    const user = await User.findByPk(user_id);

    if (!product || !user) {
      return res.status(400).json("Invalid user or product");
    }

    const plan =
      (await Plan.findOne({ where: { product_id: product.id } })) ||
      (product.whm_package_name
        ? await Plan.findOne({
            where: { whm_package_name: product.whm_package_name },
          })
        : null);

    if (!plan) {
      return res
        .status(400)
        .json("No hosting plan linked to this product");
    }

    /* ================= DOMAIN PRICE ================= */
    let domainPrice = 0;

    if (domain) {
      const tld = "." + domain.split(".").pop();

      const pricing = await DomainPricing.findOne({
        where: { tld },
      });

      domainPrice =
        Number(pricing?.register_price || 0) +
        Number(pricing?.register_margin || 0);
    }

    /* ================= PRODUCT PRICE ================= */
    let productPrice = 0;

    if (product.pricing_json && billing_cycle) {
      let pricing = {};

      try {
        pricing =
          typeof product.pricing_json === "string"
            ? JSON.parse(product.pricing_json)
            : product.pricing_json;
      } catch {
        pricing = {};
      }

      productPrice = Number(
        pricing?.INR?.[billing_cycle]?.price || 0
      );
    } else {
      productPrice = Number(product.price || 0);
    }

    const total = productPrice + domainPrice;

    const order = await Order.create({
      user_id,
      plan_id: plan.id,
      domain,
      billing_cycle: billing_cycle || null,
      plan_price: productPrice,
      domain_price: domainPrice,
      total_price: total,
      payment_session_id: null,
      status: "paid",
      domain_status: "active",
      type: "hosting",
    });

    await handleOrderSuccess(order, {
      billing_cycle: billing_cycle || null,
    });

    return res.json({
      success: true,
      message: "Admin order created successfully",
      order,
    });

  } catch (err) {
    console.log("CREATE ORDER ERROR:", err.response?.data || err.message);
    res.status(500).json("Order creation failed");
  }
};

/* ===============================
   GET ALL ORDERS
================================ */
exports.getOrders = async (req, res) => {
  const orders = await Order.findAll({
    include: [User, Plan],
    order: [["createdAt", "DESC"]],
  });

  res.json(orders);
};

exports.getOrdersSeparated = async (req, res) => {
  const hostingOrders = await Order.findAll({
    where: { type: "hosting" },
    include: [User, Plan],
  });

  const domainOrders = await Order.findAll({
    where: { type: "domain" },
    include: [User],
  });

  res.json({
    hostingOrders,
    domainOrders,
  });
};
