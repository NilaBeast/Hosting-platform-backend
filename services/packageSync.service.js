const Plan = require("../models/Plan");
const { fetchWHMPackages } = require("./whmPackage.service");

let consecutiveFailures = 0;
let lastFailureLogAt = 0;

exports.syncPackagesToDB = async () => {
  try {
    if (String(process.env.WHM_SYNC_ENABLED || "").toLowerCase() === "false") {
      return;
    }

    const packages = await fetchWHMPackages();
    consecutiveFailures = 0;

    for (const pkg of packages) {
      const existing = await Plan.findOne({
        where: { whm_package_name: pkg.name },
      });

      if (!existing) {
        await Plan.create({
          name: pkg.name,
          whm_package_name: pkg.name,
          disk: pkg.disk,
          bandwidth: pkg.bandwidth,
          max_ftp: pkg.max_ftp,
          max_email: pkg.max_email,
          max_db: pkg.max_db,
          max_subdomain: pkg.max_subdomain,
          max_addon_domain: pkg.max_addon_domain,
          max_parked_domain: pkg.max_parked_domain,
          max_passenger_apps: pkg.max_passenger_apps,
          hourly_email: pkg.hourly_email,
          email_quota: pkg.email_quota,
          mailing_lists: pkg.mailing_lists,
          team_users: pkg.team_users,
          price: 0,
        });

        console.log("Inserted package:", pkg.name);
      }
    }
  } catch (err) {
    consecutiveFailures += 1;
    const message = err?.message ? String(err.message) : "Unknown error";
    const code = err?.code ? String(err.code) : null;

    const noisyNetworkCodes = new Set([
      "ETIMEDOUT",
      "ECONNABORTED",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
    ]);

    const now = Date.now();
    const shouldLog =
      !code ||
      !noisyNetworkCodes.has(code) ||
      lastFailureLogAt === 0 ||
      now - lastFailureLogAt > 10 * 60 * 1000;

    if (shouldLog) {
      lastFailureLogAt = now;
      console.log(
        "SYNC ERROR:",
        code
          ? `${message} (code=${code}, failures=${consecutiveFailures})`
          : `${message} (failures=${consecutiveFailures})`
      );
    }
  }
};
