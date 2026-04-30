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
const { Op } = require("sequelize");

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

async function getOrCreateLatestAdminProfile(userId) {
  const profiles = await UserAdminProfile.findAll({
    where: { user_id: userId },
    order: [
      ["updatedAt", "DESC"],
      ["id", "DESC"],
    ],
  });

  if (!profiles.length) {
    return UserAdminProfile.create({
      user_id: userId,
      profile_json: JSON.stringify({}),
      contacts_json: JSON.stringify([]),
    });
  }

  const asObject = (value, fallback) => safeJsonParse(value, fallback);

  const score = (p) => {
    const profileObj = asObject(p?.profile_json, {});
    const contactsArr = asObject(p?.contacts_json, []);
    const txCount = Array.isArray(profileObj?.transactions)
      ? profileObj.transactions.length
      : 0;
    const billCount = Array.isArray(profileObj?.billableItems)
      ? profileObj.billableItems.length
      : 0;
    const profileLen = typeof p?.profile_json === "string" ? p.profile_json.length : 0;
    const contactsLen = typeof p?.contacts_json === "string" ? p.contacts_json.length : 0;
    return txCount * 10000 + billCount * 5000 + profileLen + contactsLen;
  };

  const sorted = [...profiles].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sb !== sa) return sb - sa;
    const ua = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const ub = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (ub !== ua) return ub - ua;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });

  const keep = sorted[0];

  if (sorted.length > 1) {
    const mergeByKey = (items, makeKey) => {
      const out = [];
      const seen = new Set();
      for (const it of items) {
        const key = makeKey(it);
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }
      return out;
    };

    const allProfiles = sorted.map((p) => asObject(p?.profile_json, {}));
    const allContacts = sorted.flatMap((p) => {
      const c = asObject(p?.contacts_json, []);
      return Array.isArray(c) ? c : [];
    });

    const merged = {};
    for (const obj of allProfiles) {
      if (!obj || typeof obj !== "object") continue;
      for (const [k, v] of Object.entries(obj)) {
        if (merged[k] === undefined) merged[k] = v;
      }
    }

    const mergedTransactions = mergeByKey(
      allProfiles.flatMap((p) => (Array.isArray(p?.transactions) ? p.transactions : [])),
      (t) =>
        t?.legacyId != null
          ? `legacy:${t.legacyId}`
          : [t?.createdAt || "", t?.description || "", t?.amountIn || 0, t?.amountOut || 0, t?.fees || 0].join("|")
    );

    const mergedBillableItems = mergeByKey(
      allProfiles.flatMap((p) => (Array.isArray(p?.billableItems) ? p.billableItems : [])),
      (it) =>
        it?.legacyId != null
          ? `legacy:${it.legacyId}`
          : [it?.createdAt || "", it?.description || "", it?.amount || 0].join("|")
    );

    const mergedContacts = mergeByKey(
      allContacts,
      (c) => [c?.email || "", c?.phone || "", c?.firstName || "", c?.lastName || ""].join("|")
    );

    merged.transactions = mergedTransactions;
    merged.billableItems = mergedBillableItems;

    keep.profile_json = JSON.stringify(merged);
    keep.contacts_json = JSON.stringify(mergedContacts);
    await keep.save();

    const idsToRemove = sorted
      .slice(1)
      .map((p) => p?.id)
      .filter(Boolean);

    if (idsToRemove.length) {
      await UserAdminProfile.destroy({
        where: {
          user_id: userId,
          id: { [Op.in]: idsToRemove },
        },
      });
    }
  }

  return keep;
}

exports.getUserDetails = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json("Invalid user id");

    const user = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
    });
    if (!user) return res.status(404).json("User not found");

    const ordersInclude = Order?.associations?.Plan ? [{ model: Plan }] : [];
    const ticketsInclude = Ticket?.associations?.TicketReplies
      ? [{ model: TicketReply, required: false }]
      : [];

    const [
      domains,
      hostingAccounts,
      orders,
      invoices,
      tickets,
      domainsCount,
      hostingCount,
      ordersCount,
    ] = await Promise.all([
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
        include: ordersInclude,
        order: [["createdAt", "DESC"]],
      }),
      Invoice.findAll({
        where: { user_id: userId },
        order: [["createdAt", "DESC"]],
      }),
      Ticket.findAll({
        where: { user_id: userId },
        include: ticketsInclude,
        order: [["createdAt", "DESC"]],
      }),
      Domain.count({ where: { user_id: userId } }),
      HostingAccount.count({ where: { user_id: userId } }),
      Order.count({ where: { user_id: userId } }),
    ]);

    const adminProfile = await getOrCreateLatestAdminProfile(userId);

    const profile = safeJsonParse(adminProfile.profile_json, {});
    const contacts = safeJsonParse(adminProfile.contacts_json, []);

    normalizeArrayField(profile, "billableItems");
    normalizeArrayField(profile, "transactions");
    const legacyEmails =
      Array.isArray(profile?.emails) ? profile.emails : safeJsonParse(profile?.emails, null);
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

    const emailLogsForResponse =
      Array.isArray(emailLogs) && emailLogs.length
        ? emailLogs
        : Array.isArray(legacyEmails)
          ? legacyEmails
              .map((m) => ({
                user_id: userId,
                direction: "outgoing",
                source: "legacy-profile",
                legacy_key: m?.legacyId != null ? `profile_emails:${m.legacyId}` : null,
                from_email: m?.from || null,
                to_email: m?.to || user?.email || null,
                subject: m?.subject || null,
                body_text: m?.body || m?.message || null,
                body_html: null,
                status: "sent",
                createdAt: m?.createdAt || null,
                updatedAt: m?.createdAt || null,
              }))
              .filter((x) => x.to_email)
          : [];

    const userPlain = user?.get ? user.get({ plain: true }) : user;
    const domainsPlain = (domains || []).map((d) => (d?.get ? d.get({ plain: true }) : d));
    const hostingPlain = (hostingAccounts || []).map((h) => (h?.get ? h.get({ plain: true }) : h));
    const ordersPlain = (orders || []).map((o) => (o?.get ? o.get({ plain: true }) : o));
    const invoicesPlain = (invoices || []).map((i) => (i?.get ? i.get({ plain: true }) : i));

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
      user: userPlain,
      profile,
      contacts,
      domains: domainsPlain,
      hostingAccounts: hostingPlain,
      orders: ordersPlain,
      invoices: invoicesPlain,
      tickets: ticketsWithMeta,
      emailLogs: emailLogsForResponse.map((e) => (e?.get ? e.get({ plain: true }) : e)),
      meta: {
        dbName: process.env.DB_NAME || null,
        dbHost: process.env.DB_HOST || null,
        serverTime: new Date().toISOString(),
        tables: {
          users: User.getTableName(),
          domains: Domain.getTableName(),
          hostingAccounts: HostingAccount.getTableName(),
          orders: Order.getTableName(),
        },
        counts: {
          domains: domainsCount,
          hostingAccounts: hostingCount,
          orders: ordersCount,
        },
      },
      summary: {
        totalDomains: domainsCount,
        totalHostingAccounts: hostingCount,
        totalOrders: ordersCount,
        totalInvoices: invoicesPlain.length,
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
      "company",
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

    const adminProfile = await getOrCreateLatestAdminProfile(userId);

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
