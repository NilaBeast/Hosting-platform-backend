require("dotenv").config();
const app = require("./app");
const { sequelize } = require("./models");

async function startServer() {
  try {
    console.log("⏳ Connecting DB...");

    await sequelize.authenticate();
    console.log("✅ MySQL Connected");

    console.log("⏳ Syncing tables...");
    await sequelize.sync({alter: true}); // ✅ ONLY THIS
    console.log("✅ All Tables Synced");

    app.listen(process.env.PORT || 5000, () => {
      console.log("🚀 Server running");
    });

  } catch (err) {
    console.error("❌ Server error:", err);
  }
}

startServer();