const axios = require("axios");
const crypto = require("crypto");
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

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function normalizeBillingCycle(value) {
  const v = String(value || "").trim().toLowerCase();
  const map = new Map([
    ["monthly", { months: 1 }],
    ["month", { months: 1 }],
    ["1 month", { months: 1 }],
    ["quarterly", { months: 3 }],
    ["quaterly", { months: 3 }],
    ["3 months", { months: 3 }],
    ["semiannually", { months: 6 }],
    ["semi-annually", { months: 6 }],
    ["semi annually", { months: 6 }],
    ["6 months", { months: 6 }],
    ["annually", { months: 12 }],
    ["annual", { months: 12 }],
    ["1 year", { months: 12 }],
    ["yearly", { months: 12 }],
  ]);
  return map.get(v) || null;
}

function getRazorpayAuth() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const err = new Error("Razorpay keys missing");
    err.statusCode = 500;
    throw err;
  }
  return { keyId, keySecret };
}

async function createRazorpayOrder({ amountInInr, currency, receipt, notes }) {
  const { keyId, keySecret } = getRazorpayAuth();
  if ((currency || "INR") !== "INR") {
    const err = new Error("Razorpay supports INR only");
    err.statusCode = 400;
    throw err;
  }

  const amount = Math.max(0, Math.round(Number(amountInInr || 0) * 100));
  if (!amount) {
    const err = new Error("Invalid amount");
    err.statusCode = 400;
    throw err;
  }

  const response = await axios.post(
    "https://api.razorpay.com/v1/orders",
    {
      amount,
      currency: "INR",
      receipt: receipt || `rcpt_${Date.now()}`,
      notes: notes || {},
    },
    {
      auth: {
        username: keyId,
        password: keySecret,
      },
    }
  );

  return {
    keyId,
    razorpayOrderId: response.data.id,
    amount: response.data.amount,
    currency: response.data.currency,
  };
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

    const rpOrder = await createRazorpayOrder({
      amountInInr: total,
      currency: "INR",
      receipt: `domain_${req.user.id}_${Date.now()}`,
      notes: {
        user_id: String(req.user.id),
        type: "domain",
        domain,
      },
    });

    await Order.create({
      user_id: req.user.id,
      domain,
      type: "domain",

      domain_price: basePrice,
      total_price: total,

      payment_gateway: "razorpay",
      razorpay_order_id: rpOrder.razorpayOrderId,
      cashfree_order_id: null,
      payment_session_id: null,

      status: "pending",
      domain_status: "pending",
    });

    res.json({
      razorpay_key_id: rpOrder.keyId,
      razorpay_order_id: rpOrder.razorpayOrderId,
      amount: rpOrder.amount,
      currency: rpOrder.currency,
    });

  } catch (err) {
    const status = err.statusCode || 500;
    console.log(err.response?.data || err.message);
    res.status(status).json(err.message || "Domain order failed");
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

    const rpOrder = await createRazorpayOrder({
      amountInInr: total,
      currency: config?.currency || "INR",
      receipt: `hosting_${req.user.id}_${Date.now()}`,
      notes: {
        user_id: String(req.user.id),
        type: "hosting",
        plan_id: String(plan.id),
        domain: domain || "",
      },
    });

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
      total_price: total,

      payment_gateway: "razorpay",
      razorpay_order_id: rpOrder.razorpayOrderId,
      cashfree_order_id: null,
      payment_session_id: null,

      status: "pending",
      domain_status: "pending",
    });

    res.json({
      razorpay_key_id: rpOrder.keyId,
      razorpay_order_id: rpOrder.razorpayOrderId,
      amount: rpOrder.amount,
      currency: rpOrder.currency,
    });

  } catch (err) {
    const status = err.statusCode || 500;
    console.log("❌ PAYMENT ERROR:", err.response?.data || err.message);
    res.status(status).json(err.message || "Payment order failed");
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
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body || {};

    const isRazorpay = !!(razorpay_order_id && razorpay_payment_id && razorpay_signature);

    const order = isRazorpay
      ? await Order.findOne({ where: { razorpay_order_id } })
      : await Order.findOne({ where: { cashfree_order_id: orderId } });

    if (!order) return res.status(404).json("Order not found");

    if (order.status === "active") {
      return res.json({ success: true });
    }

    if (isRazorpay) {
      const { keySecret } = getRazorpayAuth();
      const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expected = crypto
        .createHmac("sha256", keySecret)
        .update(payload)
        .digest("hex");

      if (expected !== razorpay_signature) {
        order.status = "failed";
        order.payment_status = "failed";
        order.payment_gateway = "razorpay";
        order.razorpay_payment_id = razorpay_payment_id;
        order.razorpay_signature = razorpay_signature;
        await order.save();
        return res.status(400).json({ success: false });
      }

      order.payment_gateway = "razorpay";
      order.payment_method = "razorpay";
      order.payment_id = razorpay_payment_id;
      order.razorpay_payment_id = razorpay_payment_id;
      order.razorpay_signature = razorpay_signature;
    } else {
      return res.status(400).json("Unsupported payment verification payload");
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

    const cycleInfo = normalizeBillingCycle(order?.billing_cycle);
    const nextDueDate = cycleInfo ? addMonths(new Date(), cycleInfo.months) : null;

    const existingHosting = await HostingAccount.findOne({
      where: { user_id: user.id, domain: order.domain },
    });

    let hostingRecord = null;
    if (!existingHosting) {
      hostingRecord = await HostingAccount.create({
        user_id: user.id,
        cpanel_username: username,
        domain: order.domain,
        email: user.email,
        password,
        login_url: loginUrl,
        status: "active",
        service_name: productName,
        billing_cycle: order?.billing_cycle || null,
        next_due_date: nextDueDate,
        recurring_amount: Number(order.plan_price || 0) || null,
        overdue_invoice_id: null,
        overdue_started_at: null,
        overdue_notice_count: 0,
        last_overdue_notice_at: null,
        suspended_at: null,
        terminated_at: null,
      });
    } else {
      try {
        if (existingHosting.status === "suspended" && existingHosting.cpanel_username) {
          await whmService.unsuspendAccount(existingHosting.cpanel_username);
        }
      } catch {}

      await existingHosting.update({
        cpanel_username: existingHosting.cpanel_username || username,
        email: existingHosting.email || user.email,
        password: password || existingHosting.password,
        login_url: loginUrl || existingHosting.login_url,
        status: "active",
        service_name: existingHosting.service_name || productName,
        billing_cycle: order?.billing_cycle || existingHosting.billing_cycle,
        next_due_date: nextDueDate || existingHosting.next_due_date,
        recurring_amount: Number(order.plan_price || 0) || existingHosting.recurring_amount,
        overdue_invoice_id: null,
        overdue_started_at: null,
        overdue_notice_count: 0,
        last_overdue_notice_at: null,
        suspended_at: null,
        terminated_at: null,
      });
      hostingRecord = existingHosting;
    }

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
      hosting_account_id: hostingRecord?.id || null,
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
