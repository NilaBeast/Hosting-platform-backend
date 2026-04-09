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
    const { domain } = req.body;

    const tld = "." + domain.split(".").pop();
    const pricing = await DomainPricing.findOne({ where: { tld } });

    if (!pricing) {
      return res.status(400).json("Pricing not found");
    }

    const price = pricing.register_price;
    const orderId = "order_" + Date.now();

    const response = await axios.post(
      `${process.env.CASHFREE_BASE_URL}/orders`,
      {
        order_id: orderId,
        order_amount: price,
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
      type: "domain", // ✅ IMPORTANT
      domain_price: price,
      total_price: price,
      cashfree_order_id: orderId,
      payment_session_id: response.data.payment_session_id,
      status: "pending",
      domain_status: "pending",
    });

    res.json(response.data);
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
    const { planId, domain } = req.body;

    const plan = await Plan.findByPk(planId);
    if (!plan) return res.status(404).json("Plan not found");

    let domainPrice = 0;

    if (domain) {
      const tld = "." + domain.split(".").pop();
      const pricing = await DomainPricing.findOne({ where: { tld } });
      domainPrice = pricing?.register_price || 0;
    }

    const total = plan.price + domainPrice;
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

    await Order.create({
      user_id: req.user.id,
      plan_id: plan.id,
      domain,
      type: "hosting", // ✅ IMPORTANT
      plan_price: plan.price,
      domain_price: domainPrice,
      total_price: total,
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
    console.log(err.response?.data || err.message);
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

    /* SUCCESS */
    order.status = "active";
    order.payment_status = "success";
    await order.save();

    const user = await User.findByPk(order.user_id);

    /* ===============================
       DOMAIN FLOW
    ============================== */
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
      await sendInvoiceMail(user.email, pdfPath);

      return res.json({ success: true });
    }

    /* ===============================
       HOSTING FLOW (🔥 FIXED)
    ============================== */
    const plan = await Plan.findByPk(order.plan_id);

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
      cpanel_username: null,
      is_primary: true,
      is_added_to_cpanel: false,
      type: "register",
      status: "active",
    });

    /* 🔥 INVOICE + MAIL (FIXED) */
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
      description: plan.name + " Hosting Plan",
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

    await sendInvoiceMail(user.email, pdfPath);

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json("Verification failed");
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