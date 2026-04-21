const axios = require("axios");
const Order = require("../models/Order");
const Plan = require("../models/Plan");
const User = require("../models/User");
const DomainPricing = require("../models/DomainPricing");

const Product = require("../models/Product"); // 🔥 ADD THIS
const BASE = "https://test.techzuno.com";

/* ===============================
   CREATE ORDER (ADMIN → PAYMENT)
================================ */
exports.createOrder = async (req, res) => {
  try {
    const { user_id, product_id, domain, billing_cycle } = req.body;

    const product = await Product.findByPk(product_id);
    const user = await User.findByPk(user_id);

    if (!product || !user) {
      return res.status(400).json("Invalid user or product");
    }

    /* ===============================
       DOMAIN PRICE
    ============================== */
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

   /* ===============================
   🔥 PRODUCT PRICE (FIXED)
============================== */
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

    /* ===============================
       TOTAL
    ============================== */
    const total = productPrice + domainPrice;

    const orderId = "order_" + Date.now();

    /* ===============================
       CASHFREE ORDER
    ============================== */
    const response = await axios.post(
      `${process.env.CASHFREE_BASE_URL}/orders`,
      {
        order_id: orderId,
        order_amount: total,
        order_currency: "INR",
        customer_details: {
          customer_id: user.id.toString(),
          customer_email: user.email,
          customer_phone: "9999999999",
        },
        order_meta: {
          return_url: `http://localhost:5173/admin/orders?order_id=${orderId}`,
        },
      },
      {
        headers: {
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET_KEY,
          "x-api-version": "2022-09-01",
        },
      }
    );

    /* ===============================
       SAVE ORDER
    ============================== */
    await Order.create({
      user_id,
      product_id,
      domain,

      billing_cycle: billing_cycle || null, // ✅ NEW

      product_price: productPrice,
      domain_price: domainPrice,
      total_price: total,

      cashfree_order_id: orderId,
      payment_session_id: response.data.payment_session_id,

      status: "pending",
      domain_status: "pending",
      type: "hosting",
    });

    res.json(response.data);
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