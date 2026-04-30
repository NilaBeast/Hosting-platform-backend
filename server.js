require("dotenv").config();
const app = require("./app");
const { DataTypes } = require("sequelize");
const { sequelize, User } = require("./models");

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

async function startServer() {
  try {
    await cleanupStuckUserDDL();
    await sequelize.authenticate();
    await sequelize.sync({alter: true});
    await ensureUserColumns();

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
