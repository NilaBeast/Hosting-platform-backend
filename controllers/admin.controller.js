const User = require("../models/User");
const HostingAccount = require("../models/HostingAccount");
const Domain = require("../models/Domain");
const Deployment = require("../models/Deployment");
const Plan = require("../models/Plan");
const axios = require("axios");
const Order = require("../models/Order");
const Invoice = require("../models/Invoice");
const EmailLog = require("../models/EmailLog");
const UserAdminProfile = require("../models/UserAdminProfile");
const bcrypt = require("bcrypt");
const Ticket = require("../models/Ticket");
const TicketReply = require("../models/TicketReply");

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

function safeJsonParse(value, fallback) {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeArrayField(obj, key) {
  const value = obj?.[key];
  if (Array.isArray(value)) return;
  if (typeof value === "string") {
    const parsed = safeJsonParse(value, null);
    if (Array.isArray(parsed)) {
      obj[key] = parsed;
      return;
    }
  }
  obj[key] = [];
}

exports.getUserDetails = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json("Invalid user id");

    const user = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
    });
    if (!user) return res.status(404).json("User not found");

    const [domains, hostingAccounts, orders, invoices, tickets] = await Promise.all([
      Domain.findAll({
        where: { user_id: userId },
        order: [["createdAt", "DESC"]],
      }),
      HostingAccount.findAll({
        where: { user_id: userId },
        order: [["createdAt", "DESC"]],
      }),
      Order.findAll({
        where: { user_id: userId },
        include: [{ model: Plan }],
        order: [["createdAt", "DESC"]],
      }),
      Invoice.findAll({
        where: { user_id: userId },
        order: [["createdAt", "DESC"]],
      }),
      Ticket.findAll({
        where: { user_id: userId },
        include: [{ model: TicketReply, required: false }],
        order: [["createdAt", "DESC"]],
      }),
    ]);

    let adminProfile = await UserAdminProfile.findOne({
      where: { user_id: userId },
    });

    if (!adminProfile) {
      adminProfile = await UserAdminProfile.create({
        user_id: userId,
        profile_json: JSON.stringify({}),
        contacts_json: JSON.stringify([]),
      });
    }

    const profile = safeJsonParse(adminProfile.profile_json, {});
    const contacts = safeJsonParse(adminProfile.contacts_json, []);

    normalizeArrayField(profile, "billableItems");
    normalizeArrayField(profile, "transactions");
    delete profile.quotes;
    delete profile.notes;
    delete profile.logs;
    delete profile.adminNotes;
    delete profile.emails;

    const emailLogs = await EmailLog.findAll({
      where: { user_id: userId },
      order: [["createdAt", "DESC"]],
      limit: 500,
    });

    const ticketsWithMeta = (tickets || []).map((t) => {
      const plain = t?.get ? t.get({ plain: true }) : t;
      const replies = Array.isArray(plain.TicketReplies) ? plain.TicketReplies : [];
      const lastReplyAt =
        replies.length === 0
          ? null
          : replies
              .map((r) => r.createdAt)
              .filter(Boolean)
              .sort((a, b) => new Date(b) - new Date(a))[0];
      return { ...plain, lastReplyAt, repliesCount: replies.length };
    });

    res.json({
      user,
      profile,
      contacts,
      domains,
      hostingAccounts,
      orders,
      invoices,
      tickets: ticketsWithMeta,
      emailLogs: emailLogs.map((e) => (e?.get ? e.get({ plain: true }) : e)),
      summary: {
        totalDomains: domains.length,
        totalHostingAccounts: hostingAccounts.length,
        totalOrders: orders.length,
        totalInvoices: invoices.length,
      },
    });
  } catch (err) {
    res.status(500).json(err.message);
  }
};

exports.updateUserDetails = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json("Invalid user id");

    const existingUser = await User.findByPk(userId);
    if (!existingUser) return res.status(404).json("User not found");

    const userPayload = req.body?.user || {};
    const profile = req.body?.profile;
    const contacts = req.body?.contacts;

    const updatableFields = [
      "name",
      "email",
      "phone",
      "address1",
      "address2",
      "city",
      "state",
      "postcode",
      "country",
      "role",
    ];

    for (const key of updatableFields) {
      if (userPayload[key] !== undefined) {
        existingUser[key] = userPayload[key];
      }
    }

    if (userPayload.password) {
      const hash = await bcrypt.hash(userPayload.password, 10);
      existingUser.password = hash;
    }

    await existingUser.save();

    let adminProfile = await UserAdminProfile.findOne({
      where: { user_id: userId },
    });

    if (!adminProfile) {
      adminProfile = await UserAdminProfile.create({
        user_id: userId,
        profile_json: JSON.stringify({}),
        contacts_json: JSON.stringify([]),
      });
    }

    if (profile !== undefined) {
      const sanitizedProfile = { ...(profile || {}) };
      delete sanitizedProfile.quotes;
      delete sanitizedProfile.notes;
      delete sanitizedProfile.logs;
      delete sanitizedProfile.adminNotes;
      delete sanitizedProfile.emails;
      adminProfile.profile_json = JSON.stringify(sanitizedProfile);
    }

    if (contacts !== undefined) {
      adminProfile.contacts_json = JSON.stringify(
        Array.isArray(contacts) ? contacts : []
      );
    }

    await adminProfile.save();

    req.params.id = String(userId);
    return exports.getUserDetails(req, res);
  } catch (err) {
    res.status(500).json(err.message);
  }
};
