const axios = require("axios");
const Order = require("../models/Order");
const Plan = require("../models/Plan");
const User = require("../models/User");
const DomainPricing = require("../models/DomainPricing");

const BASE = "https://test.techzuno.com";

/* ===============================
   CREATE ORDER (ADMIN → PAYMENT)
================================ */
exports.createOrder = async (req, res) => {
  try {
    const { user_id, plan_id, domain } = req.body;

    const plan = await Plan.findByPk(plan_id);
    const user = await User.findByPk(user_id);

    if (!plan || !user) {
      return res.status(400).json("Invalid user or plan");
    }

    /* DOMAIN PRICE */
    let domainPrice = 0;

    if (domain) {
      const tld = "." + domain.split(".").pop();

      const pricing = await DomainPricing.findOne({
        where: { tld },
      });

      domainPrice = pricing?.register_price || 0;
    }

    const total = plan.price + domainPrice;

    const orderId = "order_" + Date.now();

    /* CASHFREE ORDER */
    const response = await axios.post(
      `${process.env.CASHFREE_BASE_URL}/orders`,
      {
        order_id: orderId,
        order_amount: total, // ✅ FIXED
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
          accept: "application/json",
          "content-type": "application/json",
          "x-api-version": "2022-09-01",
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET_KEY,
        },
      }
    );

    /* SAVE ORDER */
    await Order.create({
      user_id,
      plan_id,
      domain,

      plan_price: plan.price,
      domain_price: domainPrice,
      total_price: total,

      cashfree_order_id: orderId,
      payment_session_id: response.data.payment_session_id,

      status: "pending",
      domain_status: "pending",
    });

    res.json(response.data);
  } catch (err) {
    console.log("ADMIN ORDER ERROR:", err.response?.data || err.message);
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