const axios = require("axios");
const https = require("https");
const whmConfig = require("../config/whm");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function parseValue(val) {
  if (!val) return 0;
  if (val === "unlimited") return -1;
  return Number(val);
}

exports.fetchWHMPackages = async () => {
  const response = await axios.get(
    `${whmConfig.host}/json-api/listpkgs`,
    {
      httpsAgent,
      headers: {
        Authorization: `whm ${whmConfig.user}:${whmConfig.token}`,
      },
    }
  );

  const pkgs = response.data.package || [];

  return pkgs.map((pkg) => ({
    name: pkg.name,
    disk: parseValue(pkg.QUOTA),
    bandwidth: parseValue(pkg.BWLIMIT),
    max_ftp: parseValue(pkg.MAXFTP),
    max_email: parseValue(pkg.MAXPOP),
    max_db: parseValue(pkg.MAXSQL),
    max_subdomain: parseValue(pkg.MAXSUB),
    max_addon_domain: parseValue(pkg.MAXADDON),
    max_parked_domain: parseValue(pkg.MAXPARK),
    max_passenger_apps: parseValue(pkg.MAXPASSENGERAPPS),
    hourly_email: parseValue(pkg.MAX_EMAIL_PER_HOUR),
    email_quota: parseValue(pkg.MAX_EMAILACCT_QUOTA),
    mailing_lists: parseValue(pkg.MAXLST),
    team_users: parseValue(pkg.MAX_TEAM_USERS),
  }));
};