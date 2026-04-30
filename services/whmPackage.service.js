const axios = require("axios");
const https = require("https");
const whmConfig = require("../config/whm");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function getAxiosErrorSummary(err) {
  const code = err?.code ? String(err.code) : null;
  const status = err?.response?.status ? Number(err.response.status) : null;
  const statusText = err?.response?.statusText
    ? String(err.response.statusText)
    : null;
  const message = err?.message ? String(err.message) : "Request failed";
  return { code, status, statusText, message };
}

function buildBaseUrls(host) {
  const raw = String(host || "").trim();
  const extra = String(process.env.WHM_HOST_FALLBACKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const seeds = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const out = [];
  const add = (u) => {
    if (!u) return;
    const v = String(u).trim();
    if (!v) return;
    if (!out.includes(v)) out.push(v);
  };

  for (const s of [...seeds, ...extra]) add(s);

  if (out.length === 0 && raw) add(raw);

  const expanded = [];
  for (const u of out) {
    if (/^https?:\/\//i.test(u)) {
      expanded.push(u);
      try {
        const parsed = new URL(u);
        if (parsed.protocol === "https:" && parsed.port === "2087") {
          expanded.push(`http://${parsed.hostname}:2086`);
        }
        if (!parsed.port) {
          expanded.push(`https://${parsed.hostname}:2087`);
          expanded.push(`http://${parsed.hostname}:2086`);
        }
      } catch {}
    } else {
      expanded.push(`https://${u}:2087`);
      expanded.push(`http://${u}:2086`);
      expanded.push(`https://${u}`);
    }
  }

  return [...new Set(expanded)];
}

function parseValue(val) {
  if (!val) return 0;
  if (val === "unlimited") return -1;
  return Number(val);
}

exports.fetchWHMPackages = async () => {
  try {
    const host = whmConfig.host;
    const user = whmConfig.user;
    const token = whmConfig.token;
    if (!host || !user || !token) {
      throw new Error("WHM config missing (WHM_HOST/WHM_USER/WHM_TOKEN)");
    }

    const baseUrls = buildBaseUrls(host);
    let response = null;
    let lastErr = null;
    for (const baseUrl of baseUrls) {
      try {
        const isHttps = /^https:\/\//i.test(baseUrl);
        response = await axios.get(`${baseUrl}/json-api/listpkgs`, {
          httpsAgent: isHttps ? httpsAgent : undefined,
          timeout: Number(process.env.WHM_TIMEOUT_MS || 20000),
          family: 4,
          headers: {
            Authorization: `whm ${user}:${token}`,
          },
        });
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!response) throw lastErr || new Error("Failed to fetch WHM packages");

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
  } catch (err) {
    const summary = getAxiosErrorSummary(err);
    const details = [
      summary.code ? `code=${summary.code}` : null,
      summary.status ? `status=${summary.status}` : null,
      summary.statusText ? `statusText=${summary.statusText}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(
      `Failed to fetch WHM packages: ${summary.message}${details ? ` (${details})` : ""}`
    );
  }
};

exports.getWHMPackages = exports.fetchWHMPackages;
