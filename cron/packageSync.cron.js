const cron = require("node-cron");
const { syncPackagesToDB } = require("../services/packageSync.service");

/* Every 1 minute */
cron.schedule("* * * * *", async () => {
  console.log("Checking WHM packages...");
  await syncPackagesToDB();
});