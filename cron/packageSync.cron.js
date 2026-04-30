const cron = require("node-cron");
const { syncPackagesToDB } = require("../services/packageSync.service");

console.log("WHM package sync cron loaded");

async function run() {
  console.log("Checking WHM packages...");
  if (String(process.env.WHM_SYNC_ENABLED || "").toLowerCase() === "false") {
    return;
  }
  await syncPackagesToDB();
}

(async () => {
  try {
    await run();
  } catch {}
})();

cron.schedule("* * * * *", async () => {
  try {
    await run();
  } catch {}
});
