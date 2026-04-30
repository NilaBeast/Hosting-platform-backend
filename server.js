const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const app = require("./app");
const { DataTypes } = require("sequelize");
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
    await autoMigrateIfNeeded();
    require("./cron/packageSync.cron");
    require("./cron/domainPricing.cron");

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
