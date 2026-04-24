const axios = require("axios");
const Order = require("../models/Order");
const Plan = require("../models/Plan");
const User = require("../models/User");
const HostingAccount = require("../models/HostingAccount");
const Domain = require("../models/Domain");
const DomainPricing = require("../models/DomainPricing");
const whmService = require("../services/whm.service");

const Invoice = require("../models/Invoice");
const InvoiceItem = require("../models/InvoiceItem");
const { generateInvoicePDF } = require("../services/invoice.service");
const { sendInvoiceMail } = require("../services/invoiceMail.service");

/* ===============================
   PASSWORD GENERATOR
================================ */
function generateStrongPassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
  return Array.from({ length: 14 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/* ===============================
   DOMAIN ONLY ORDER
================================ */
exports.createDomainOrder = async (req, res) => {
  try {
    const { domain, years = 1 } = req.body;

    if (!domain) {
      return res.status(400).json("Domain required");
    }

    /* ===============================
       🔥 FIX TLD (SUPPORT .co.in)
    ============================== */
    const parts = domain.split(".");
    let tld = "." + parts.slice(-2).join(".");

    let pricing = await DomainPricing.findOne({ where: { tld } });

    if (!pricing) {
      tld = "." + parts.pop();
      pricing = await DomainPricing.findOne({ where: { tld } });
    }

    if (!pricing) {
      return res.status(400).json("Pricing not found");
    }

    /* ===============================
       🔥 MULTI YEAR PRICE
    ============================== */
    let basePrice = pricing.register_price || 0;

    let total = basePrice * years;

    /* ===============================
       🔥 APPLY MARGIN (IF EXISTS)
    ============================== */
    if (pricing.register_margin) {
      total += pricing.register_margin * years;
    }

    const orderId = "order_" + Date.now();

    const response = await axios.post(
      `${process.env.CASHFREE_BASE_URL}/orders`,
      {
        order_id: orderId,
        order_amount: total,
        order_currency: "INR",
        customer_details: {
          customer_id: req.user.id.toString(),
          customer_email: req.user.email,
          customer_phone: "9999999999",
        },
        order_meta: {
          return_url: `http://localhost:5173/domains?order_id=${orderId}`,
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

    await Order.create({
      user_id: req.user.id,
      domain,
      type: "domain",

      domain_price: basePrice,
      total_price: total,

      years,
      tld,

      cashfree_order_id: orderId,
      payment_session_id: response.data.payment_session_id,

      status: "pending",
      domain_status: "pending",
    });

    res.json({
      payment_session_id: response.data.payment_session_id,
      order_id: orderId,
      amount: total,
    });

  } catch (err) {
    console.log(err.response?.data || err.message);
    res.status(500).json("Domain order failed");
  }
};

/* ===============================
   HOSTING + DOMAIN ORDER
================================ */
exports.createPaymentOrder = async (req, res) => {
  try {
    console.log("🔥 PAYMENT HIT:", req.body);

    let { planId, productId, domain, config } = req.body;

    let plan = null;

    /* ===============================
       🔥 FIX: SUPPORT PRODUCT → PLAN
    ============================== */
    if (planId) {
      plan = await Plan.findByPk(planId);
    }

    // 🔥 If plan not found, try productId
    if (!plan && productId) {
      plan = await Plan.findOne({
        where: { product_id: productId },
      });
    }

    if (!plan) {
      console.log("❌ PLAN NOT FOUND:", { planId, productId });
      return res.status(404).json("Plan not found");
    }

    console.log("✅ PLAN FOUND:", plan.id);

    /* ===============================
       DOMAIN PRICE
    ============================== */
    let domainPrice = 0;

    if (domain) {
      const tld = "." + domain.split(".").pop();

      const pricing = await DomainPricing.findOne({
        where: { tld },
      });

      domainPrice = pricing?.register_price || 0;
    }

    /* ===============================
       PLAN PRICE
    ============================== */
    let planPrice = 0;

    if (config?.price) {
      planPrice = Number(config.price);
    } else {
      planPrice = Number(plan.price || 0);
    }

    /* ===============================
       ADDONS
    ============================== */
    let addonPrice = 0;

    if (config?.dns) addonPrice += 50;
    if (config?.privacy) addonPrice += 100;

    const total = planPrice + domainPrice + addonPrice;

    const orderId = "order_" + Date.now();

    /* ===============================
       CASHFREE ORDER
    ============================== */
    const response = await axios.post(
      `${process.env.CASHFREE_BASE_URL}/orders`,
      {
        order_id: orderId,
        order_amount: total,
        order_currency: config?.currency || "INR",
        customer_details: {
          customer_id: req.user.id.toString(),
          customer_email: req.user.email,
          customer_phone: "9999999999",
        },
        order_meta: {
          return_url: `http://localhost:5173/plans?order_id=${orderId}`,
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
      user_id: req.user.id,
      plan_id: plan.id,
      domain,
      type: "hosting",

      plan_price: planPrice,
      domain_price: domainPrice,
      addon_price: addonPrice,
      total_price: total,

      billing_cycle: config?.cycle || "monthly",
      currency: config?.currency || "INR",

      cashfree_order_id: orderId,
      payment_session_id: response.data.payment_session_id,

      status: "pending",
      domain_status: "pending",
    });

    res.json({
      payment_session_id: response.data.payment_session_id,
      order_id: orderId,
    });

  } catch (err) {
    console.log("❌ PAYMENT ERROR:", err.response?.data || err.message);
    res.status(500).json("Payment order failed");
  }
};

/* ===============================
   VERIFY PAYMENT (FIXED)
================================ */
/* ===============================
   VERIFY PAYMENT (FINAL FIXED)
================================ */
exports.verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    /* ===============================
       VERIFY FROM CASHFREE
    ============================== */
    const response = await axios.get(
      `${process.env.CASHFREE_BASE_URL}/orders/${orderId}`,
      {
        headers: {
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET_KEY,
          "x-api-version": "2022-09-01",
        },
      }
    );

    const order = await Order.findOne({
      where: { cashfree_order_id: orderId },
    });

    if (!order) return res.status(404).json("Order not found");

    const status = response.data.order_status;

    if (status === "ACTIVE") {
      return res.json({ pending: true });
    }

    if (status === "FAILED" || status === "EXPIRED") {
      order.status = "failed";
      await order.save();
      return res.json({ success: false });
    }

    if (status !== "PAID") {
      return res.json({ pending: true });
    }

    /* ===============================
       SUCCESS PAYMENT
    ============================== */
    order.status = "active";
    order.payment_status = "success";
    await order.save();

    const user = await User.findByPk(order.user_id);

    /* =========================================================
       🔥 DOMAIN ONLY FLOW
    ========================================================= */
    if (order.type === "domain" || !order.plan_id) {
      await Domain.create({
        user_id: user.id,
        domain: order.domain,
        is_primary: false,
        is_added_to_cpanel: false,
        type: "register",
        status: "active",
      });

      const invoiceNumber = "INV-" + Date.now();

      const invoice = await Invoice.create({
        user_id: user.id,
        order_id: order.id,
        invoice_number: invoiceNumber,
        customer_name: user.name,
        email: user.email,
        amount: order.total_price,
        status: "paid",
      });

      await InvoiceItem.create({
        invoice_id: invoice.id,
        description: `Domain (${order.domain})`,
        qty: 1,
        rate: order.domain_price,
        amount: order.domain_price,
      });

      const items = await InvoiceItem.findAll({
        where: { invoice_id: invoice.id },
      });

      const pdfPath = await generateInvoicePDF(invoice, items);

      if (!pdfPath) throw new Error("PDF generation failed");

      await Invoice.update(
        { pdf_path: pdfPath },
        { where: { id: invoice.id } }
      );

      await sendInvoiceMail(user.id, user.email, pdfPath);

      return res.json({ success: true });
    }

    /* =========================================================
       🔥 HOSTING + DOMAIN FLOW (FIXED)
    ========================================================= */

    // 🔥 IMPORTANT FIX → include Product
    const plan = await Plan.findByPk(order.plan_id, {
      include: [
        {
          model: require("../models/Product"),
          attributes: ["name"],
        },
      ],
    });

    if (!plan) {
      console.log("❌ PLAN NOT FOUND:", order.plan_id);
      return res.status(404).json("Plan not found");
    }

    // 🔥 USE PRODUCT NAME (NOT PLAN NAME)
    const productName =
      plan?.Product?.name || plan.name || "Hosting Plan";

    const username = order.domain.split(".")[0].substring(0, 8);
    const password = generateStrongPassword();

    await whmService.createAccount({
      username,
      domain: order.domain,
      password,
      email: user.email,
      packageName: plan.whm_package_name,
    });

    const loginUrl = await whmService.createCpanelSession(username);

    await HostingAccount.create({
      user_id: user.id,
      cpanel_username: username,
      domain: order.domain,
      email: user.email,
      password,
      login_url: loginUrl,
      status: "active",
    });

    await Domain.create({
      user_id: user.id,
      domain: order.domain,
      is_primary: true,
      is_added_to_cpanel: false,
      type: "register",
      status: "active",
    });

    /* ===== CREATE INVOICE ===== */
    const invoiceNumber = "INV-" + Date.now();

    const invoice = await Invoice.create({
      user_id: user.id,
      order_id: order.id,
      invoice_number: invoiceNumber,
      customer_name: user.name,
      email: user.email,
      amount: order.total_price,
      status: "paid",
    });

    // 🔥 FIXED DESCRIPTION HERE
    await InvoiceItem.create({
      invoice_id: invoice.id,
      description: `${productName} Hosting Plan`,
      qty: 1,
      rate: order.plan_price,
      amount: order.plan_price,
    });

    await InvoiceItem.create({
      invoice_id: invoice.id,
      description: `Domain (${order.domain})`,
      qty: 1,
      rate: order.domain_price,
      amount: order.domain_price,
    });

    const items = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id },
    });

    const pdfPath = await generateInvoicePDF(invoice, items);

    if (!pdfPath) throw new Error("PDF generation failed");

    await Invoice.update(
      { pdf_path: pdfPath },
      { where: { id: invoice.id } }
    );

    await sendInvoiceMail(user.id, user.email, pdfPath);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ VERIFY PAYMENT ERROR:", err);
    res.status(500).json(err.message || "Verification failed");
  }
};

/* ===============================
   GET USER ORDERS
================================ */
exports.getMyOrders = async (req, res) => {
  const orders = await Order.findAll({
    where: { user_id: req.user.id },
  });

  res.json(orders);
};

exports.createCheckoutSession = async (req, res) => {
  try {
    const { planId, domain, config } = req.body;

    const order = await Order.create({
      user_id: req.user.id,
      plan_id: planId || null,
      domain,
      type: planId ? "hosting" : "domain",
      checkout_data: config, // 🔥 FULL CONFIG SAVED
      status: "draft",
    });

    res.json({ orderId: order.id });
  } catch (err) {
    res.status(500).json("Checkout init failed");
  }
};
