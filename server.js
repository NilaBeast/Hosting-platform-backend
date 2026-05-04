const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const app = require("./app");
const { DataTypes, Op } = require("sequelize");
const { sequelize, User } = require("./models");
const Domain = require("./models/Domain");
const HostingAccount = require("./models/HostingAccount");
const Invoice = require("./models/Invoice");
const InvoiceItem = require("./models/InvoiceItem");
const Plan = require("./models/Plan");
const Ticket = require("./models/Ticket");
const TicketReply = require("./models/TicketReply");
const EmailLog = require("./models/EmailLog");
const UserAdminProfile = require("./models/UserAdminProfile");
const cron = require("node-cron");
const { generateInvoicePDF } = require("./services/invoice.service");
const { sendBillingReminderMail } = require("./services/invoiceMail.service");
const whmService = require("./services/whm.service");

const bootstrapKeepAlive = setInterval(() => {}, 1000);

async function cleanupStuckUserDDL() {
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    const [rows] = await conn.query("SHOW PROCESSLIST");
    const victims = (rows || [])
      .filter((r) => {
        const state = String(r.State || "").toLowerCase();
        const info = String(r.Info || "").toLowerCase();
        if (!info.includes("alter table")) return false;
        if (!info.includes("users")) return false;
        if (!state.includes("metadata lock")) return false;
        return Number(r.Time || 0) >= 30;
      })
      .map((r) => r.Id)
      .filter(Boolean);

    if (victims.length) {
      for (const id of victims) {
        try {
          await conn.query(`KILL ${Number(id)}`);
        } catch {}
      }
      console.log(`✅ Cleared ${victims.length} stuck Users table DDL queries`);
    }
  } finally {
    await conn.end();
  }
}

async function cleanupStuckProductWrites() {
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    try {
      await conn.query("SET SESSION innodb_lock_wait_timeout = 10");
    } catch {}
    try {
      await conn.query("SET SESSION lock_wait_timeout = 10");
    } catch {}
    try {
      await conn.query("SET GLOBAL innodb_lock_wait_timeout = 10");
    } catch {}
    try {
      await conn.query("SET GLOBAL lock_wait_timeout = 10");
    } catch {}

    let myConnId = null;
    try {
      const [[row]] = await conn.query("SELECT CONNECTION_ID() AS id");
      myConnId = Number(row?.id || 0) || null;
    } catch {}

    const victims = new Set();

    try {
      const [trx] = await conn.query(
        "SELECT trx_mysql_thread_id AS thread_id, trx_started AS started_at, trx_query AS query_text FROM information_schema.innodb_trx"
      );
      for (const r of trx || []) {
        const q = String(r.query_text || "").toLowerCase();
        const startedAt = r.started_at ? new Date(r.started_at).getTime() : 0;
        const ageSec = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
        if (ageSec < 30) continue;
        if (
          q.includes("products") ||
          q.includes("productgroups") ||
          q.includes("plans") ||
          q.includes("alter table")
        ) {
          const threadId = Number(r.thread_id || 0) || null;
          if (!threadId) continue;
          if (myConnId && threadId === myConnId) continue;
          victims.add(threadId);
        }
      }
    } catch {}

    try {
      const [rows] = await conn.query("SHOW PROCESSLIST");
      for (const r of rows || []) {
        const state = String(r.State || "").toLowerCase();
        const info = String(r.Info || "").toLowerCase();
        const id = Number(r.Id || 0) || null;
        if (!id) continue;
        if (myConnId && id === myConnId) continue;

        const matchesCatalog =
          info.includes("products") || info.includes("productgroups") || info.includes("plans");
        if (!matchesCatalog) continue;

        const looksStuck =
          state.includes("opening tables") ||
          state.includes("metadata lock") ||
          state.includes("waiting for table metadata lock") ||
          state.includes("waiting for table flush") ||
          state.includes("table lock");

        const timeSec = Number(r.Time || 0) || 0;
        if (!looksStuck) continue;
        if (timeSec < 5) continue;
        victims.add(id);
      }
    } catch {}

    if (victims.size) {
      for (const id of victims) {
        try {
          await conn.query(`KILL ${Number(id)}`);
        } catch {}
      }
      console.log(`✅ Cleared ${victims.size} stuck catalog queries`);
    }
  } finally {
    await conn.end();
  }
}

async function ensureUserColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const tableName = User.getTableName();
  const table = await queryInterface.describeTable(tableName);

  const columns = {
    company: DataTypes.STRING,
    phone: DataTypes.STRING,
    address1: DataTypes.STRING,
    address2: DataTypes.STRING,
    city: DataTypes.STRING,
    state: DataTypes.STRING,
    postcode: DataTypes.STRING,
    country: DataTypes.STRING,
  };

  for (const [name, type] of Object.entries(columns)) {
    if (!table[name]) {
      await queryInterface.addColumn(tableName, name, {
        type,
        allowNull: true,
      });
    }
  }
}

async function ensureInvoiceColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const tableName = Invoice.getTableName();
  const table = await queryInterface.describeTable(tableName);

  const columns = {
    due_date: DataTypes.DATE,
    invoice_type: DataTypes.STRING,
    meta_json: DataTypes.TEXT("long"),
    hosting_account_id: DataTypes.INTEGER,
  };

  for (const [name, type] of Object.entries(columns)) {
    if (!table[name]) {
      await queryInterface.addColumn(tableName, name, { type, allowNull: true });
    }
  }
}

async function ensureHostingColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const tableName = HostingAccount.getTableName();
  const table = await queryInterface.describeTable(tableName);

  const columns = {
    recurring_amount: DataTypes.FLOAT,
    overdue_invoice_id: DataTypes.INTEGER,
    overdue_started_at: DataTypes.DATE,
    overdue_notice_count: DataTypes.INTEGER,
    last_overdue_notice_at: DataTypes.DATE,
    suspended_at: DataTypes.DATE,
    terminated_at: DataTypes.DATE,
  };

  for (const [name, type] of Object.entries(columns)) {
    if (!table[name]) {
      await queryInterface.addColumn(tableName, name, { type, allowNull: true });
    }
  }
}

async function ensureOrderColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const Order = require("./models/Order");
  const tableName = Order.getTableName();
  const table = await queryInterface.describeTable(tableName);

  if (!table.billing_cycle) {
    await queryInterface.addColumn(tableName, "billing_cycle", {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }
}

function startOfDay(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  const da = startOfDay(a).getTime();
  const db = startOfDay(b).getTime();
  return Math.round((db - da) / 86400000);
}

function formatDateKey(d) {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
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

async function createOrReuseInvoiceForHosting({
  userId,
  email,
  customerName,
  hostingAccountId,
  invoiceNumber,
  dueDate,
  amount,
  invoiceType,
  items,
  meta,
}) {
  const existing = await Invoice.findOne({ where: { invoice_number: invoiceNumber } });
  const invoice =
    existing ||
    (await Invoice.create({
      user_id: userId,
      order_id: null,
      hosting_account_id: hostingAccountId,
      invoice_number: invoiceNumber,
      customer_name: customerName,
      email,
      amount,
      status: "unpaid",
      due_date: dueDate,
      invoice_type: invoiceType,
      meta_json: meta ? JSON.stringify(meta) : null,
    }));

  if (!existing) {
    for (const item of items || []) {
      await InvoiceItem.create({
        invoice_id: invoice.id,
        description: item.description,
        qty: item.qty,
        rate: item.rate,
        amount: item.amount,
      });
    }
  }

  const invoiceItems = await InvoiceItem.findAll({ where: { invoice_id: invoice.id } });
  const pdfPath = invoice.pdf_path || (await generateInvoicePDF(invoice, invoiceItems));

  if (!invoice.pdf_path && pdfPath) {
    await invoice.update({ pdf_path: pdfPath });
  }

  return { invoice, pdfPath };
}

async function runRenewalBilling() {
  if (String(process.env.BILLING_RENEWAL_ENABLED || "true").toLowerCase() === "false") return;

  const today = new Date();
  const reminders = new Set([7, 5, 3, 1]);

  const accounts = await HostingAccount.findAll({
    where: { status: { [Op.in]: ["active", "suspended"] } },
    order: [["id", "ASC"]],
  });

  for (const accRow of accounts || []) {
    const acc = accRow?.get ? accRow.get({ plain: true }) : accRow;
    const due = acc?.next_due_date ? new Date(acc.next_due_date) : null;
    if (!due || !Number.isFinite(due.getTime())) continue;

    const user = await User.findByPk(acc.user_id, { attributes: ["id", "name", "email"] });
    if (!user) continue;

    const amountBase = Number(acc.recurring_amount || 0);
    const amount = Number.isFinite(amountBase) && amountBase > 0 ? amountBase : 0;
    if (!amount) continue;

    const daysUntilDue = daysBetween(today, due);
    const dueKey = formatDateKey(due);

    if (daysUntilDue >= 0 && reminders.has(daysUntilDue) && acc.status === "active") {
      const invoiceNumber = `REN-${acc.id}-${dueKey}`;
      const legacyKey = `renewal:${acc.id}:${dueKey}:pre:${daysUntilDue}`;

      const items = [
        {
          description: `${acc.service_name || "Hosting Plan"} (${acc.billing_cycle || "Renewal"})`,
          qty: 1,
          rate: amount,
          amount,
        },
      ];

      const { pdfPath } = await createOrReuseInvoiceForHosting({
        userId: user.id,
        email: user.email,
        customerName: user.name,
        hostingAccountId: acc.id,
        invoiceNumber,
        dueDate: due,
        amount,
        invoiceType: "renewal",
        items,
        meta: { daysUntilDue },
      });

      if (pdfPath) {
        await sendBillingReminderMail(user.id, user.email, pdfPath, {
          legacy_key: legacyKey,
          subject: `Renewal Reminder - Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`,
          title: "Service Renewal Reminder",
          message: `Your hosting service is due for renewal. Please pay before the due date to avoid suspension.`,
          next_due_date: due,
          amount,
          severity: daysUntilDue <= 3 ? "warning" : "info",
        });
      }

      continue;
    }

    if (daysUntilDue < 0) {
      const daysOverdue = Math.abs(daysUntilDue);

      if (acc.status === "active") {
        try {
          if (acc.cpanel_username) {
            await whmService.suspendAccount(
              acc.cpanel_username,
              `Overdue: ${due.toLocaleDateString()}`
            );
          }
        } catch {}

        await HostingAccount.update(
          {
            status: "suspended",
            suspended_at: new Date(),
            overdue_started_at: new Date(),
            overdue_notice_count: 0,
          },
          { where: { id: acc.id } }
        );
      }

      const accFresh = await HostingAccount.findByPk(acc.id);
      const curr = accFresh?.get ? accFresh.get({ plain: true }) : accFresh;
      const noticeCount = Number(curr?.overdue_notice_count || 0);
      const lastNoticeAt = curr?.last_overdue_notice_at ? new Date(curr.last_overdue_notice_at) : null;
      const alreadySentToday =
        lastNoticeAt && startOfDay(lastNoticeAt).getTime() === startOfDay(today).getTime();

      const penalty = Math.round(amount * 0.05 * 100) / 100;
      const total = Math.round((amount + penalty) * 100) / 100;

      const invoiceNumber = `OVD-${acc.id}-${dueKey}`;
      const overdueInvoiceId = curr?.overdue_invoice_id || null;

      if (!overdueInvoiceId) {
        const items = [
          {
            description: `${curr?.service_name || "Hosting Plan"} (${curr?.billing_cycle || "Renewal"})`,
            qty: 1,
            rate: amount,
            amount,
          },
          {
            description: "Overdue charge (5%)",
            qty: 1,
            rate: penalty,
            amount: penalty,
          },
        ];

        const { invoice, pdfPath } = await createOrReuseInvoiceForHosting({
          userId: user.id,
          email: user.email,
          customerName: user.name,
          hostingAccountId: curr.id,
          invoiceNumber,
          dueDate: due,
          amount: total,
          invoiceType: "overdue",
          items,
          meta: { overdue: true },
        });

        await HostingAccount.update(
          { overdue_invoice_id: invoice.id },
          { where: { id: curr.id } }
        );

        if (pdfPath) {
          await sendBillingReminderMail(user.id, user.email, pdfPath, {
            legacy_key: `renewal:${curr.id}:${dueKey}:overdue:first`,
            subject: "Payment Overdue - Account Suspended",
            title: "Payment Overdue",
            message: `Your hosting account is overdue and has been suspended. Please pay the attached invoice to reactivate. Due date was ${due.toLocaleDateString()}.`,
            next_due_date: due,
            amount: total,
            severity: "danger",
          });
        }

        await HostingAccount.update(
          { overdue_notice_count: noticeCount + 1, last_overdue_notice_at: new Date() },
          { where: { id: curr.id } }
        );

        continue;
      }

      if (!alreadySentToday && noticeCount < 3) {
        const inv = await Invoice.findOne({ where: { id: overdueInvoiceId } });
        const pdfPath = inv?.pdf_path || null;
        if (pdfPath) {
          await sendBillingReminderMail(user.id, user.email, pdfPath, {
            legacy_key: `renewal:${curr.id}:${dueKey}:overdue:warn:${noticeCount + 1}`,
            subject: `Overdue Warning (${noticeCount + 1}/3) - Risk of Termination`,
            title: "Overdue Warning",
            message: `Your account remains overdue. This is warning ${noticeCount + 1} of 3. If unpaid, your account will be permanently terminated after 3 days.`,
            next_due_date: due,
            amount: Number(inv?.amount || total),
            severity: "danger",
          });
        }

        await HostingAccount.update(
          { overdue_notice_count: noticeCount + 1, last_overdue_notice_at: new Date() },
          { where: { id: curr.id } }
        );
        continue;
      }

      if (daysOverdue >= 3 && noticeCount >= 3 && curr?.status === "suspended" && !curr?.terminated_at) {
        try {
          if (curr.cpanel_username) {
            await whmService.terminateAccount(curr.cpanel_username);
          }
        } catch {}

        await HostingAccount.update(
          { status: "terminated", terminated_at: new Date() },
          { where: { id: curr.id } }
        );
      }
    }
  }
}

async function backfillInvoiceHostingAccountId() {
  if (String(process.env.BILLING_BACKFILL_ENABLED || "true").toLowerCase() === "false")
    return;

  const Order = require("./models/Order");

  const invoices = await Invoice.findAll({
    where: { hosting_account_id: null },
    order: [["id", "ASC"]],
    limit: 200,
  });

  if (!invoices.length) return;

  for (const invRow of invoices) {
    const inv = invRow?.get ? invRow.get({ plain: true }) : invRow;

    if (!inv?.order_id) continue;

    const ord = await Order.findByPk(inv.order_id);
    if (!ord) continue;

    const domain = ord?.domain ? String(ord.domain) : null;
    const userId = ord?.user_id || inv?.user_id || null;
    if (!userId || !domain) continue;

    const hosting = await HostingAccount.findOne({
      where: { user_id: userId, domain },
    });
    if (!hosting) continue;

    await Invoice.update(
      { hosting_account_id: hosting.id },
      { where: { id: inv.id } }
    );
  }
}

async function backfillLegacyOrdersFromInvoices() {
  if (String(process.env.BILLING_BACKFILL_ENABLED || "true").toLowerCase() === "false")
    return;

  const Order = require("./models/Order");

  const invoices = await Invoice.findAll({
    where: { order_id: null },
    order: [["id", "ASC"]],
    limit: 200,
  });

  if (!invoices.length) return;

  for (const invRow of invoices) {
    const inv = invRow?.get ? invRow.get({ plain: true }) : invRow;
    const invoiceNumber = inv?.invoice_number ? String(inv.invoice_number) : null;
    if (!invoiceNumber) continue;

    const existingOrder = await Order.findOne({
      where: { user_id: inv.user_id, payment_id: invoiceNumber },
    });

    if (existingOrder) {
      await Invoice.update(
        { order_id: existingOrder.id },
        { where: { id: inv.id, order_id: null } }
      );
      continue;
    }

    const hosting =
      (inv.hosting_account_id
        ? await HostingAccount.findByPk(inv.hosting_account_id)
        : null) ||
      (await HostingAccount.findOne({
        where: { user_id: inv.user_id },
        order: [["id", "ASC"]],
      }));

    const hostingPlain = hosting?.get ? hosting.get({ plain: true }) : hosting;

    const statusRaw = String(inv?.status || "").toLowerCase();
    const isPaid = statusRaw === "paid";

    const created = await Order.create({
      user_id: inv.user_id,
      plan_id: null,
      domain: hostingPlain?.domain || null,
      billing_cycle: hostingPlain?.billing_cycle || null,
      plan_price: Number(inv.amount || 0) || 0,
      domain_price: 0,
      total_price: Number(inv.amount || 0) || 0,
      status: isPaid ? "paid" : "pending",
      domain_status: "active",
      type: "hosting",
      payment_id: invoiceNumber,
      payment_gateway: "legacy",
      createdAt: inv?.createdAt || undefined,
      updatedAt: inv?.updatedAt || inv?.createdAt || undefined,
    });

    await Invoice.update({ order_id: created.id }, { where: { id: inv.id } });
    if (!inv.hosting_account_id && hostingPlain?.id) {
      await Invoice.update(
        { hosting_account_id: hostingPlain.id },
        { where: { id: inv.id, hosting_account_id: null } }
      );
    }
  }
}

function extractDomainFromText(text) {
  if (!text) return null;
  const s = String(text);
  const m = s.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
  return m ? String(m[0]).toLowerCase() : null;
}

function isDomainInvoiceItem(description) {
  const s = String(description || "").toLowerCase();
  if (!s) return false;
  if (!s.includes("domain")) return false;
  return true;
}

async function backfillLegacyOrdersPlanAndDomainPrices() {
  if (String(process.env.BILLING_BACKFILL_ENABLED || "true").toLowerCase() === "false")
    return;

  const Order = require("./models/Order");

  const orders = await Order.findAll({
    where: {
      payment_gateway: "legacy",
      [Op.or]: [{ plan_id: null }, { domain: null }, { domain_price: 0 }],
    },
    order: [["id", "ASC"]],
    limit: 200,
  });

  if (!orders.length) return;

  for (const ordRow of orders) {
    const ord = ordRow?.get ? ordRow.get({ plain: true }) : ordRow;
    const paymentId = ord?.payment_id ? String(ord.payment_id) : null;
    if (!paymentId) continue;

    const invoice = await Invoice.findOne({
      where: { user_id: ord.user_id, invoice_number: paymentId },
    });
    if (!invoice) continue;

    const items = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id },
      order: [["id", "ASC"]],
    });

    const itemPlain = (items || []).map((i) => (i?.get ? i.get({ plain: true }) : i));

    const domainFromItems =
      itemPlain.map((i) => extractDomainFromText(i?.description)).find(Boolean) || null;

    const hosting =
      (invoice.hosting_account_id ? await HostingAccount.findByPk(invoice.hosting_account_id) : null) ||
      (ord.domain
        ? await HostingAccount.findOne({ where: { user_id: ord.user_id, domain: ord.domain } })
        : await HostingAccount.findOne({ where: { user_id: ord.user_id }, order: [["id", "ASC"]] }));

    const hostingPlain = hosting?.get ? hosting.get({ plain: true }) : hosting;

    const domain =
      (ord.domain ? String(ord.domain) : null) ||
      domainFromItems ||
      (hostingPlain?.domain ? String(hostingPlain.domain) : null);

    const domainPrice = itemPlain
      .filter((i) => isDomainInvoiceItem(i?.description))
      .reduce((sum, i) => sum + (Number(i?.amount || 0) || 0), 0);

    const total = Number(ord.total_price || invoice.amount || 0) || 0;
    const planPrice =
      domainPrice > 0 ? Math.max(0, Math.round((total - domainPrice) * 100) / 100) : total;

    let planId = ord.plan_id || null;
    if (!planId) {
      const candidate =
        (hostingPlain?.service_name ? String(hostingPlain.service_name) : null) ||
        itemPlain
          .filter((i) => !isDomainInvoiceItem(i?.description))
          .map((i) => String(i?.description || "").trim())
          .find((d) => d && d.length >= 3) ||
        null;

      if (candidate) {
        const PlanModel = Plan;
        const exact =
          (await PlanModel.findOne({ where: { whm_package_name: candidate } })) ||
          (await PlanModel.findOne({ where: { name: candidate } }));
        if (exact) {
          planId = exact.id;
        } else {
          const like =
            (await PlanModel.findOne({ where: { whm_package_name: { [Op.like]: `%${candidate}%` } } })) ||
            (await PlanModel.findOne({ where: { name: { [Op.like]: `%${candidate}%` } } }));
          planId = like?.id || null;
        }
      }
    }

    await Order.update(
      {
        plan_id: planId,
        domain: domain,
        plan_price: planPrice,
        domain_price: domainPrice > 0 ? domainPrice : ord.domain_price,
      },
      { where: { id: ord.id } }
    );

    if (!invoice.order_id) {
      await Invoice.update({ order_id: ord.id }, { where: { id: invoice.id } });
    }

    if (!invoice.hosting_account_id && hostingPlain?.id) {
      await Invoice.update(
        { hosting_account_id: hostingPlain.id },
        { where: { id: invoice.id, hosting_account_id: null } }
      );
    }
  }
}

async function normalizeNullDatabaseFields() {
  if (String(process.env.NORMALIZE_NULLS || "true").toLowerCase() === "false") return;

  const qi = sequelize.getQueryInterface();
  const [groupRows] = await sequelize.query(
    "SELECT id FROM productgroups ORDER BY id ASC LIMIT 1"
  );
  const firstGroupId = groupRows?.[0]?.id ? Number(groupRows[0].id) : null;

  try {
    await sequelize.query(
      "UPDATE users SET company = '' WHERE company IS NULL"
    );
  } catch {}
  try {
    await sequelize.query("UPDATE users SET phone = '' WHERE phone IS NULL");
  } catch {}
  try {
    await sequelize.query(
      "UPDATE users SET address1 = '' WHERE address1 IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE users SET address2 = '' WHERE address2 IS NULL"
    );
  } catch {}
  try {
    await sequelize.query("UPDATE users SET city = '' WHERE city IS NULL");
  } catch {}
  try {
    await sequelize.query("UPDATE users SET state = '' WHERE state IS NULL");
  } catch {}
  try {
    await sequelize.query(
      "UPDATE users SET postcode = '' WHERE postcode IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE users SET country = '' WHERE country IS NULL"
    );
  } catch {}

  try {
    await sequelize.query(
      "UPDATE productgroups SET name = CONCAT('Group-', id) WHERE name IS NULL OR name = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE productgroups SET headline = '' WHERE headline IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE productgroups SET tagline = '' WHERE tagline IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE productgroups SET slug = CONCAT('group-', id) WHERE slug IS NULL OR slug = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE productgroups SET is_hidden = 0 WHERE is_hidden IS NULL"
    );
  } catch {}

  if (firstGroupId) {
    try {
      await sequelize.query(
        `UPDATE products SET product_group_id = ${firstGroupId} WHERE product_group_id IS NULL`
      );
    } catch {}
  }

  try {
    await sequelize.query(
      "UPDATE products SET name = CONCAT('Product-', id) WHERE name IS NULL OR name = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET description = '' WHERE description IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET short_description = '' WHERE short_description IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET slug = CONCAT('product-', id) WHERE slug IS NULL OR slug = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET free_domain_type = 'none' WHERE free_domain_type IS NULL OR free_domain_type = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET is_hidden = 0 WHERE is_hidden IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET price = 0 WHERE price IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET pricing_json = COALESCE(pricing_json, JSON_OBJECT())"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET upgrades = COALESCE(upgrades, JSON_ARRAY())"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE products SET free_domain_tlds = COALESCE(free_domain_tlds, JSON_ARRAY())"
    );
  } catch {}

  try {
    await sequelize.query(
      "UPDATE plans SET name = CONCAT('Plan-', id) WHERE name IS NULL OR name = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET whm_package_name = CONCAT('pkg-', id) WHERE whm_package_name IS NULL OR whm_package_name = ''"
    );
  } catch {}
  try {
    await sequelize.query("UPDATE plans SET price = 0 WHERE price IS NULL");
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET disk = 0 WHERE disk IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET bandwidth = 0 WHERE bandwidth IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET max_ftp = 0 WHERE max_ftp IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET max_email = 0 WHERE max_email IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET max_db = 0 WHERE max_db IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET max_subdomain = 0 WHERE max_subdomain IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET max_addon_domain = 0 WHERE max_addon_domain IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET max_parked_domain = 0 WHERE max_parked_domain IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET max_passenger_apps = 0 WHERE max_passenger_apps IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET hourly_email = 0 WHERE hourly_email IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET email_quota = 0 WHERE email_quota IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET mailing_lists = 0 WHERE mailing_lists IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET team_users = 0 WHERE team_users IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE plans SET pricing_json = COALESCE(pricing_json, JSON_OBJECT())"
    );
  } catch {}

  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET status = 'active' WHERE status IS NULL OR status = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET overdue_notice_count = 0 WHERE overdue_notice_count IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET recurring_amount = 0 WHERE recurring_amount IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET service_name = '' WHERE service_name IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET billing_cycle = '' WHERE billing_cycle IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET email = '' WHERE email IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET cpanel_username = '' WHERE cpanel_username IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET domain = '' WHERE domain IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET password = '' WHERE password IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET login_url = '' WHERE login_url IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE hostingaccounts SET overdue_invoice_id = 0 WHERE overdue_invoice_id IS NULL"
    );
  } catch {}

  try {
    await sequelize.query(
      "UPDATE domains SET status = 'active' WHERE status IS NULL OR status = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE domains SET type = 'register' WHERE type IS NULL OR type = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE domains SET recurring_amount = 0 WHERE recurring_amount IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE domains SET registration_period = 1 WHERE registration_period IS NULL"
    );
  } catch {}

  try {
    await sequelize.query(
      "UPDATE invoices i JOIN users u ON u.id = i.user_id SET i.customer_name = COALESCE(i.customer_name, u.name), i.email = COALESCE(i.email, u.email)"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE invoices SET status = 'unknown' WHERE status IS NULL OR status = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE invoices SET invoice_type = 'legacy' WHERE invoice_type IS NULL OR invoice_type = ''"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE invoices SET meta_json = '{}' WHERE meta_json IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE invoices SET pdf_path = '' WHERE pdf_path IS NULL"
    );
  } catch {}

  try {
    await sequelize.query(
      "UPDATE invoiceitems SET description = '' WHERE description IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE invoiceitems SET qty = 1 WHERE qty IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE invoiceitems SET rate = 0 WHERE rate IS NULL"
    );
  } catch {}
  try {
    await sequelize.query(
      "UPDATE invoiceitems SET amount = 0 WHERE amount IS NULL"
    );
  } catch {}
}

let autoMigrationRan = false;
async function autoMigrateIfNeeded() {
  if (autoMigrationRan) return;
  if (String(process.env.AUTO_MIGRATE || "").toLowerCase() !== "true") {
    console.log("ℹ️ AUTO_MIGRATE is disabled (set AUTO_MIGRATE=true to enable).");
    return;
  }

  const counts = Object.fromEntries(
    await Promise.all(
      [
        ["users", User],
        ["domains", Domain],
        ["hostingAccounts", HostingAccount],
        ["plans", Plan],
        ["invoices", Invoice],
        ["invoiceItems", InvoiceItem],
        ["tickets", Ticket],
        ["ticketReplies", TicketReply],
        ["emailLogs", EmailLog],
        ["adminProfiles", UserAdminProfile],
      ].map(async ([key, model]) => {
        const value = await model.count();
        return [key, value];
      })
    )
  );

  const emptyTables = Object.entries(counts)
    .filter(([, value]) => value === 0)
    .map(([key]) => key);

  if (emptyTables.length === 0) {
    console.log("ℹ️ Skipping migration import (tables already have data).", counts);
    return;
  }

  const { runMigration, DEFAULT_SQL_PATH } = require("./extract_migration_data");
  const sqlPath = process.env.MIGRATION_SQL_PATH || DEFAULT_SQL_PATH;
  const fs = require("fs");
  if (!fs.existsSync(sqlPath)) {
    console.log("❌ Migration SQL file not found:", sqlPath);
    return;
  }
  autoMigrationRan = true;
  console.log("⏳ Some tables are empty. Running migration import...", {
    sqlPath,
    emptyTables,
    counts,
  });
  await runMigration({ sqlPath, sync: false, dryRun: false });
  console.log("✅ Migration import completed");
}

async function startServer() {
  try {
    await cleanupStuckUserDDL();
    await cleanupStuckProductWrites();
    console.log("⏳ Connecting to MySQL...");
    await sequelize.authenticate();
    console.log("✅ MySQL Database Connected Successfully");
    await sequelize.sync();
    await ensureUserColumns();
    await ensureInvoiceColumns();
    await ensureHostingColumns();
    await ensureOrderColumns();
    await autoMigrateIfNeeded();
    await normalizeNullDatabaseFields();
    require("./cron/packageSync.cron");
    require("./cron/domainPricing.cron");

    cron.schedule("15 2 * * *", () => {
      runRenewalBilling().catch(() => {});
    });

    runRenewalBilling().catch(() => {});
    backfillInvoiceHostingAccountId().catch(() => {});
    backfillLegacyOrdersFromInvoices().catch(() => {});
    backfillLegacyOrdersPlanAndDomainPrices().catch(() => {});

    app.listen(process.env.PORT || 5000, () => {
      clearInterval(bootstrapKeepAlive);
      console.log("🚀 Server running");
    });
  } catch (err) {
    clearInterval(bootstrapKeepAlive);
    console.error("❌ Server error:", err);
  }
}

startServer();
