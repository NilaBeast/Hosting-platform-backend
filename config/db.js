const { Sequelize } = require("sequelize");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/* ===============================
   CREATE SEQUELIZE INSTANCE
================================ */
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",

    /* 🔥 CONNECTION POOL (VERY IMPORTANT) */
    pool: {
      max: 5,        // max connections
      min: 0,
      acquire: 60000, // wait up to 60s
      idle: 10000,    // release idle connections
    },

    /* 🔥 TIMEOUT FIX */
    dialectOptions: {
      connectTimeout: 60000,
    },

    logging: false,
  }
);

sequelize.addHook("afterConnect", async (connection) => {
  const conn = typeof connection?.promise === "function" ? connection.promise() : connection;
  try {
    await conn.query("SET SESSION innodb_lock_wait_timeout = 10");
  } catch {}
  try {
    await conn.query("SET SESSION lock_wait_timeout = 10");
  } catch {}
});

module.exports = sequelize;
