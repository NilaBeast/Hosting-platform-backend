const User = require("../models/User");
const HostingAccount = require("../models/HostingAccount");
const Domain = require("../models/Domain");
const Deployment = require("../models/Deployment");
const Plan = require("../models/Plan");
const axios = require("axios");
const Order = require("../models/Order");

const BASE = "https://test.techzuno.com";

/* ===============================
   REGISTER DOMAIN (ADMIN BUTTON)
================================ */
exports.registerDomain = async (req, res) => {
  try {
    const { orderId, domain } = req.body;

    const order = await Order.findByPk(orderId);
    const user = await User.findByPk(order.user_id);

    const selectedDomain = domain || order.domain;

    const payload = {
      domain: selectedDomain,
      regperiod: 1,
      ns1: "ns1.hostzuno.com",
      ns2: "ns2.hostzuno.com",

      firstname: user.name?.split(" ")[0],
      lastname: user.name?.split(" ")[1] || "User",
      email: user.email,
      fullphonenumber: "+919999999999",

      address1: "Kolkata",
      city: "Kolkata",
      state: "WB",
      country: "IN",
      postcode: "700001",
    };

    const response = await axios.post(
      `${BASE}/api/registrars/wbeen/domains/register`,
      payload
    );

    if (response.data?.error) {
      return res.status(400).json(response.data);
    }

    order.domain_status = "registered";
    await order.save();

    res.json({ message: "Domain registered" });
  } catch (err) {
    res.status(500).json(err.message);
  }
};
/* ===============================
   DASHBOARD STATS
================================ */
/* ===============================
   DASHBOARD STATS
================================ */
exports.getDashboardStats = async (req, res) => {
  try {
    const pendingOrders = await Order.count({
      where: { status: "pending" },
    });

    const paidOrders = await Order.count({
      where: { status: "paid" },
    });

    const pendingDomain = await Order.count({
      where: { domain_status: "pending" },
    });

    const users = await User.count();

    res.json({
      pendingOrders,
      paidOrders,
      pendingDomain,
      users,
      ticketsWaiting: 0,
    });
  } catch (err) {
    res.status(500).json(err.message);
  }
};

/* ===============================
   USERS
================================ */
exports.getAllUsers = async (req, res) => {
  const users = await User.findAll({
    order: [["createdAt", "DESC"]],
  });

  res.json(users);
};

/* ===============================
   HOSTING ORDERS
================================ */
exports.getAllOrders = async (req, res) => {
  const orders = await Order.findAll({
    include: [User, Plan],
    order: [["createdAt", "DESC"]],
  });

  res.json(orders);
};
/* ===============================
   DEPLOYMENTS
================================ */
exports.getAllDeployments = async (req, res) => {
  const deployments = await Deployment.findAll({
    order: [["createdAt", "DESC"]],
  });

  res.json(deployments);
};