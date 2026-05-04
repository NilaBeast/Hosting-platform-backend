const whmService = require("./whm.service");

const HostingAccount = require("../models/HostingAccount");
const Domain = require("../models/Domain");
const Invoice = require("../models/Invoice");
const InvoiceItem = require("../models/InvoiceItem");
const User = require("../models/User");
const Product = require("../models/Product");
const ProductGroup = require("../models/ProductGroup");
const Plan = require("../models/Plan");

const { generateInvoicePDF } = require("./invoice.service");
const { sendInvoiceMail } = require("./invoiceMail.service");

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
    ["monthly", { months: 1, label: "Monthly" }],
    ["month", { months: 1, label: "Monthly" }],
    ["1 month", { months: 1, label: "Monthly" }],
    ["quarterly", { months: 3, label: "Quarterly" }],
    ["quaterly", { months: 3, label: "Quarterly" }],
    ["3 months", { months: 3, label: "Quarterly" }],
    ["semiannually", { months: 6, label: "Semi Annually" }],
    ["semi-annually", { months: 6, label: "Semi Annually" }],
    ["semi annually", { months: 6, label: "Semi Annually" }],
    ["6 months", { months: 6, label: "Semi Annually" }],
    ["annually", { months: 12, label: "Annually" }],
    ["annual", { months: 12, label: "Annually" }],
    ["1 year", { months: 12, label: "Annually" }],
    ["yearly", { months: 12, label: "Annually" }],
  ]);
  return map.get(v) || null;
}

/* ===============================
   PASSWORD GENERATOR
================================ */
function generatePassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  return Array.from({ length: 14 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/* ===============================
   USERNAME GENERATOR (WHM SAFE)
================================ */
function generateUsername(domain) {
  let name = domain.split(".")[0];

  // WHM rules: max 8 chars, lowercase, no special chars
  name = name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  return name.substring(0, 8);
}

/* ===============================
   MAIN FLOW
================================ */
exports.handleOrderSuccess = async (order, meta = {}) => {
  try {
    console.log("🚀 START ORDER SUCCESS FLOW");

    const normalizedOrder = {
      ...(order?.get ? order.get({ plain: true }) : order),
      ...meta,
    };

    const user = await User.findByPk(normalizedOrder.user_id);
    if (!user) throw new Error("User not found");

    const plan = normalizedOrder.plan_id
      ? await Plan.findByPk(normalizedOrder.plan_id, {
          include: [
            {
              model: Product,
              include: [
                {
                  model: ProductGroup,
                  attributes: ["id", "name"],
                },
              ],
              attributes: ["id", "name", "whm_package_name"],
            },
          ],
        })
      : null;

    const productName = plan?.Product?.name || plan?.name || "Hosting Plan";
    const groupName = plan?.Product?.ProductGroup?.name || null;

    const packageName =
      plan?.whm_package_name || plan?.Product?.whm_package_name || "default";

    /* ===============================
       WHM ACCOUNT CREATION
    ============================== */
    const username = generateUsername(normalizedOrder.domain);
    const password = generatePassword();

    console.log("➡️ Creating WHM account...");

    await whmService.createAccount({
      username,
      domain: normalizedOrder.domain,
      password,
      email: user.email,
      packageName,
    });

    const loginUrl = await whmService.createCpanelSession(username);

    console.log("✅ WHM account created");

    /* ===============================
       SAVE HOSTING ACCOUNT
    ============================== */
    const existingHosting = await HostingAccount.findOne({
      where: { user_id: normalizedOrder.user_id, domain: normalizedOrder.domain },
    });

    let hostingRecord = null;

    if (!existingHosting) {
      hostingRecord = await HostingAccount.create({
        user_id: normalizedOrder.user_id,
        cpanel_username: username,
        domain: normalizedOrder.domain,
        email: user.email,
        password,
        login_url: loginUrl,
        status: "active",
        service_name: productName,
        billing_cycle: billingCycle,
        next_due_date: nextDueDate,
        recurring_amount: planPrice || null,
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
        billing_cycle: billingCycle || existingHosting.billing_cycle,
        next_due_date: nextDueDate || existingHosting.next_due_date,
        recurring_amount: planPrice || existingHosting.recurring_amount,
        overdue_invoice_id: null,
        overdue_started_at: null,
        overdue_notice_count: 0,
        last_overdue_notice_at: null,
        suspended_at: null,
        terminated_at: null,
      });
      hostingRecord = existingHosting;
    }

    console.log("✅ Hosting saved");

    /* ===============================
       SAVE DOMAIN
    ============================== */
    if (normalizedOrder.domain) {
      await Domain.create({
        user_id: normalizedOrder.user_id,
        domain: normalizedOrder.domain,
        cpanel_username: username,
        is_primary: true,
        status: "active",
      });

      console.log("✅ Domain saved");
    }

    /* ===============================
       CREATE INVOICE
    ============================== */
    const invoiceNumber = "INV-" + Date.now();

    const invoice = await Invoice.create({
      user_id: normalizedOrder.user_id,
      order_id: normalizedOrder.id || null,
      hosting_account_id: hostingRecord?.id || null,
      invoice_number: invoiceNumber,
      customer_name: user.name,
      email: user.email,
      amount: normalizedOrder.total_price,
      status: "paid",
    });

    console.log("✅ Invoice created");

    /* ===============================
       BUILD INVOICE ITEMS
    ============================== */
    const items = [];

    // 🔥 Hosting Item
    const planPrice = Number(normalizedOrder.plan_price || 0);
    const billingCycle = normalizedOrder.billing_cycle || normalizedOrder?.billing_cycle || null;
    const cycleInfo = normalizeBillingCycle(billingCycle);
    const now = new Date();
    const nextDueDate = cycleInfo ? addMonths(now, cycleInfo.months) : null;
    let hostingLabel = groupName ? `${groupName} - ${productName}` : productName;
    if (packageName && packageName !== "default") {
      hostingLabel = `${hostingLabel} - ${packageName}`;
    }

    items.push({
      description: `${hostingLabel} (${billingCycle})`,
      qty: 1,
      rate: planPrice,
      amount: planPrice,
    });

    // 🔥 Domain Item
    const domainPrice = Number(normalizedOrder.domain_price || 0);

    if (normalizedOrder.domain && domainPrice > 0) {
      items.push({
        description: `Domain Registration (${normalizedOrder.domain})`,
        qty: 1,
        rate: domainPrice,
        amount: domainPrice,
      });
    }

    console.log("🧾 Invoice Items:", items);

    /* ===============================
       INSERT ITEMS
    ============================== */
    for (const item of items) {
      await InvoiceItem.create({
        invoice_id: invoice.id,
        description: item.description,
        qty: item.qty,
        rate: item.rate,
        amount: item.amount,
      });
    }

    /* ===============================
       FETCH ITEMS FOR PDF
    ============================== */
    const invoiceItems = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id },
    });

    console.log("📄 Generating PDF...");

    /* ===============================
       GENERATE PDF
    ============================== */
    const pdfPath = await generateInvoicePDF(invoice, invoiceItems);

    if (!pdfPath) throw new Error("PDF generation failed");

    await Invoice.update(
      { pdf_path: pdfPath },
      { where: { id: invoice.id } }
    );

    console.log("✅ PDF saved:", pdfPath);

    /* ===============================
       SEND EMAIL
    ============================== */
    await sendInvoiceMail(user.id, user.email, pdfPath);

    console.log("📩 Email sent");

    console.log("🎉 ORDER FLOW COMPLETED SUCCESSFULLY");

  } catch (err) {
    console.log("❌ ORDER SUCCESS FLOW ERROR:", err.message);
    throw err;
  }
};
