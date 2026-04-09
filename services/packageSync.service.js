const Plan = require("../models/Plan");
const { fetchWHMPackages } = require("./whmPackage.service");

exports.syncPackagesToDB = async () => {
  try {
    const packages = await fetchWHMPackages();

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
    console.log("SYNC ERROR:", err);
  }
};