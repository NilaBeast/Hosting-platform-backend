const { Sequelize } = require("sequelize");
require("dotenv").config();

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
      max: 10,        // max connections
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

/* ===============================
   TEST DB CONNECTION
================================ */
async function connectDB() {
  try {
    console.log("⏳ Connecting to MySQL...");

    await sequelize.authenticate();

    console.log("✅ MySQL Database Connected Successfully");
  } catch (error) {
    console.error("❌ Unable to connect to MySQL:", error.message);

    // Optional: exit process if DB fails
    process.exit(1);
  }
}

connectDB();

module.exports = sequelize;