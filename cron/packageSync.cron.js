const cron = require("node-cron");
const { syncPackagesToDB } = require("../services/packageSync.service");

/* Every 1 minute */
cron.schedule("* * * * *", async () => {
  if (String(process.env.WHM_SYNC_ENABLED || "").toLowerCase() === "false") {
    return;
  }
  console.log("Checking WHM packages...");
  await syncPackagesToDB();
});
