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
  const rawKeyId =
    process.env.RAZORPAY_KEY_ID ||
    process.env.RAZORPAY_KEYID ||
    process.env.RAZORPAY_KEY;
  const rawKeySecret =
    process.env.RAZORPAY_KEY_SECRET ||
    process.env.RAZORPAY_SECRET ||
    process.env.RAZORPAY_KEYSECRET;

  const normalize = (v) => {
    if (v == null) return "";
    const s = String(v).trim();
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      return s.slice(1, -1).trim();
    }
    return s;
  };

  const keyId = normalize(rawKeyId);
  const keySecret = normalize(rawKeySecret);
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

  let response;
  try {
    response = await axios.post(
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
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      const err = new Error(
        "Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server .env"
      );
      err.statusCode = 500;
      throw err;
    }
    throw e;
  }

  return {
    keyId,
    razorpayOrderId: response.data.id,
    amount: response.data.amount,
    currency: response.data.currency,
  };
}

function getPayUConfig() {
  const key = process.env.PAYU_KEY;
  const salt = process.env.PAYU_SALT;
  const baseUrl = process.env.PAYU_BASE_URL || "https://test.payu.in";
  if (!key || !salt) {
    const err = new Error("PayU config missing (PAYU_KEY/PAYU_SALT)");
    err.statusCode = 500;
    throw err;
  }
  return { key, salt, baseUrl };
}

function sha512(value) {
  return crypto.createHash("sha512").update(String(value)).digest("hex");
}

function buildPayURequestHash({ key, txnid, amount, productinfo, firstname, email, salt }) {
  const raw = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||||${salt}`;
  return sha512(raw);
}

function verifyPayUResponseHash({ key, salt, status, email, firstname, amount, txnid, productinfo, receivedHash }) {
  const raw = `${salt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  const expected = sha512(raw);
  return String(expected).toLowerCase() === String(receivedHash || "").toLowerCase();
}

async function finalizeSuccessfulOrder(order) {
  if (!order) return;
  if (order.status === "active") return;

  order.status = "active";
  order.payment_status = "success";
  await order.save();

  const user = await User.findByPk(order.user_id);
  if (!user) throw new Error("User not found");

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

    await Invoice.update({ pdf_path: pdfPath }, { where: { id: invoice.id } });
    await sendInvoiceMail(user.id, user.email, pdfPath);
    return;
  }

  const plan = await Plan.findByPk(order.plan_id, {
    include: [
      {
        model: require("../models/Product"),
        attributes: ["name"],
      },
    ],
  });

  if (!plan) throw new Error("Plan not found");

  const productName = plan?.Product?.name || plan.name || "Hosting Plan";

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

  await InvoiceItem.create({
    invoice_id: invoice.id,
    description: `${productName} Hosting Plan`,
    qty: 1,
    rate: order.plan_price,
    amount: order.plan_price,
  });

  if (Number(order.domain_price || 0) > 0) {
    await InvoiceItem.create({
      invoice_id: invoice.id,
      description: `Domain (${order.domain})`,
      qty: 1,
      rate: order.domain_price,
      amount: order.domain_price,
    });
  }

  const items = await InvoiceItem.findAll({
    where: { invoice_id: invoice.id },
  });

  const pdfPath = await generateInvoicePDF(invoice, items);

  if (!pdfPath) throw new Error("PDF generation failed");

  await Invoice.update({ pdf_path: pdfPath }, { where: { id: invoice.id } });
  await sendInvoiceMail(user.id, user.email, pdfPath);
}

/* ===============================
   DOMAIN ONLY ORDER
================================ */
exports.createDomainOrder = async (req, res) => {
  try {
    const { domain, years = 1, gateway } = req.body;

    if (!domain) {
      return res.status(400).json("Domain required");
    }

    const targetUser = await User.findByPk(req.user.id);
    if (!targetUser) return res.status(404).json("User not found");

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

    const chosen = String(gateway || "razorpay").toLowerCase();

    if (chosen === "payu") {
      const { key, salt, baseUrl } = getPayUConfig();
      const txnid = `payu_${req.user.id}_${Date.now()}`;
      const amountStr = Number(total || 0).toFixed(2);
      const productinfo = `Domain purchase (${domain})`;
      const firstname = String(targetUser?.name || "").trim() || "Customer";
      const email = String(targetUser?.email || "").trim() || "";
      const hash = buildPayURequestHash({
        key,
        salt,
        txnid,
        amount: amountStr,
        productinfo,
        firstname,
        email,
      });

      await Order.create({
        user_id: req.user.id,
        domain,
        type: "domain",
        domain_price: basePrice,
        total_price: total,
        payment_gateway: "payu",
        payment_method: "payu",
        payment_id: null,
        payment_session_id: txnid,
        status: "pending",
        payment_status: "pending",
        domain_status: "pending",
      });

      return res.json({
        gateway: "payu",
        actionUrl: `${baseUrl}/_payment`,
        fields: {
          key,
          txnid,
          amount: amountStr,
          productinfo,
          firstname,
          email,
          phone: String(targetUser?.phone || "").trim() || "9999999999",
          surl: `${process.env.SERVER_BASE_URL || "http://localhost:5000"}/api/payment/payu/callback`,
          furl: `${process.env.SERVER_BASE_URL || "http://localhost:5000"}/api/payment/payu/callback`,
          hash,
        },
      });
    }
    if (chosen !== "razorpay") {
      return res.status(400).json("Unsupported gateway");
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
      payment_method: "razorpay",
      razorpay_order_id: rpOrder.razorpayOrderId,
      payment_session_id: null,
      status: "pending",
      payment_status: "pending",
      domain_status: "pending",
    });

    return res.json({
      gateway: "razorpay",
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

    let { planId, productId, domain, config, gateway, userId } = req.body;

    const targetUserId =
      req.user?.role === "admin" && userId ? Number(userId) : Number(req.user.id);
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser) return res.status(404).json("User not found");

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
    const billingCycle = config?.cycle || config?.billing_cycle || null;

    const chosen = String(gateway || "razorpay").toLowerCase();

    if (chosen === "payu") {
      const { key, salt, baseUrl } = getPayUConfig();
      const txnid = `payu_${targetUserId}_${Date.now()}`;
      const amountStr = Number(total || 0).toFixed(2);
      const productinfo = `Hosting purchase (${domain || "Hosting"})`;
      const firstname = String(targetUser?.name || "").trim() || "Customer";
      const email = String(targetUser?.email || "").trim() || "";
      const hash = buildPayURequestHash({
        key,
        salt,
        txnid,
        amount: amountStr,
        productinfo,
        firstname,
        email,
      });

      await Order.create({
        user_id: targetUserId,
        plan_id: plan.id,
        domain,
        type: "hosting",
        billing_cycle: billingCycle,
        plan_price: planPrice,
        domain_price: domainPrice,
        total_price: total,
        payment_gateway: "payu",
        payment_method: "payu",
        payment_id: null,
        payment_session_id: txnid,
        status: "pending",
        payment_status: "pending",
        domain_status: "pending",
      });

      return res.json({
        gateway: "payu",
        actionUrl: `${baseUrl}/_payment`,
        fields: {
          key,
          txnid,
          amount: amountStr,
          productinfo,
          firstname,
          email,
          phone: String(targetUser?.phone || "").trim() || "9999999999",
          surl: `${process.env.SERVER_BASE_URL || "http://localhost:5000"}/api/payment/payu/callback`,
          furl: `${process.env.SERVER_BASE_URL || "http://localhost:5000"}/api/payment/payu/callback`,
          hash,
        },
      });
    }
    if (chosen !== "razorpay") {
      return res.status(400).json("Unsupported gateway");
    }

    const rpOrder = await createRazorpayOrder({
      amountInInr: total,
      currency: config?.currency || "INR",
      receipt: `hosting_${targetUserId}_${Date.now()}`,
      notes: {
        user_id: String(targetUserId),
        type: "hosting",
        plan_id: String(plan.id),
        domain: domain || "",
      },
    });

    await Order.create({
      user_id: targetUserId,
      plan_id: plan.id,
      domain,
      type: "hosting",
      billing_cycle: billingCycle,
      plan_price: planPrice,
      domain_price: domainPrice,
      total_price: total,
      payment_gateway: "razorpay",
      payment_method: "razorpay",
      razorpay_order_id: rpOrder.razorpayOrderId,
      payment_session_id: null,
      status: "pending",
      payment_status: "pending",
      domain_status: "pending",
    });

    return res.json({
      gateway: "razorpay",
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
    const body = req.body || {};
    const gateway = String(body.gateway || "").toLowerCase();

    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      body;

    const isRazorpay = gateway === "razorpay" || (!!(razorpay_order_id && razorpay_payment_id && razorpay_signature));

    if (!isRazorpay) {
      return res.status(400).json("Unsupported payment verification payload");
    }

    const order = await Order.findOne({ where: { razorpay_order_id } });

    if (!order) return res.status(404).json("Order not found");

    if (order.status === "active") {
      return res.json({ success: true });
    }

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
      order.payment_method = "razorpay";
      order.razorpay_payment_id = razorpay_payment_id;
      order.razorpay_signature = razorpay_signature;
      await order.save();
      return res.status(400).json({ success: false });
    }

    order.payment_gateway = "razorpay";
    order.payment_method = "razorpay";
    order.payment_id = razorpay_payment_id;
    order.payment_status = "success";
    order.razorpay_payment_id = razorpay_payment_id;
    order.razorpay_signature = razorpay_signature;

    await finalizeSuccessfulOrder(order);
    res.json({ success: true });

  } catch (err) {
    console.error("❌ VERIFY PAYMENT ERROR:", err);
    res.status(500).json(err.message || "Verification failed");
  }
};

exports.payuCallback = async (req, res) => {
  try {
    const payload = req.body || {};
    const txnid = String(payload.txnid || "");
    const status = String(payload.status || "");
    const hash = String(payload.hash || "");
    const email = String(payload.email || "");
    const firstname = String(payload.firstname || "");
    const amount = String(payload.amount || "");
    const productinfo = String(payload.productinfo || "");

    const { key, salt } = getPayUConfig();
    const ok = verifyPayUResponseHash({
      key,
      salt,
      status,
      email,
      firstname,
      amount,
      txnid,
      productinfo,
      receivedHash: hash,
    });

    const order = await Order.findOne({
      where: { payment_gateway: "payu", payment_session_id: txnid },
    });

    const clientBase = process.env.CLIENT_BASE_URL || "http://localhost:5173";

    if (!order) {
      return res.redirect(`${clientBase}/checkout/success?gateway=payu&status=failed`);
    }

    if (!ok) {
      order.status = "failed";
      order.payment_status = "failed";
      order.payment_gateway = "payu";
      order.payment_method = "payu";
      await order.save();
      return res.redirect(`${clientBase}/checkout/success?gateway=payu&status=failed`);
    }

    if (String(status).toLowerCase() !== "success") {
      order.status = "failed";
      order.payment_status = "failed";
      order.payment_gateway = "payu";
      order.payment_method = "payu";
      await order.save();
      return res.redirect(`${clientBase}/checkout/success?gateway=payu&status=failed`);
    }

    order.payment_gateway = "payu";
    order.payment_method = "payu";
    order.payment_id = String(payload.mihpayid || payload.payuMoneyId || payload.bank_ref_num || txnid);
    order.payment_status = "success";
    await order.save();

    await finalizeSuccessfulOrder(order);

    return res.redirect(`${clientBase}/checkout/success?gateway=payu&status=success`);
  } catch (err) {
    const clientBase = process.env.CLIENT_BASE_URL || "http://localhost:5173";
    return res.redirect(`${clientBase}/checkout/success?gateway=payu&status=failed`);
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
