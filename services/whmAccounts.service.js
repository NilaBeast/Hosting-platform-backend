const axios = require("axios");
const https = require("https");
const whmConfig = require("../config/whm");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

let lastSuccess = {
  accounts: null,
  fetchedAt: null,
  baseUrl: null,
};

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

async function fetchFromBaseUrl(baseUrl, user, token, timeoutMs) {
  const url = `${baseUrl}/json-api/listaccts?api.version=1`;
  const isHttps = /^https:\/\//i.test(baseUrl);
  const res = await axios.get(url, {
    httpsAgent: isHttps ? httpsAgent : undefined,
    timeout: Number.isFinite(Number(timeoutMs))
      ? Number(timeoutMs)
      : Number(process.env.WHM_TIMEOUT_MS || 20000),
    family: 4,
    headers: {
      Authorization: `whm ${user}:${token}`,
    },
  });
  return res.data?.data?.acct || [];
}

exports.getWHMAccounts = async () => {
  const meta = await exports.getWHMAccountsWithMeta();
  return meta.accounts;
};

exports.getCachedWHMAccountsMeta = () => {
  if (!Array.isArray(lastSuccess.accounts)) return null;
  return {
    accounts: lastSuccess.accounts,
    fetchedAt: lastSuccess.fetchedAt,
    baseUrl: lastSuccess.baseUrl,
  };
};

exports.refreshWHMAccountsCache = async (opts = {}) => {
  const host = whmConfig.host;
  const user = whmConfig.user;
  const token = whmConfig.token;
  if (!host || !user || !token) {
    throw new Error("WHM config missing (WHM_HOST/WHM_USER/WHM_TOKEN)");
  }

  const baseUrls = buildBaseUrls(host);
  const timeoutMs = opts?.timeoutMs;
  let lastErr = null;
  for (const baseUrl of baseUrls) {
    try {
      const accounts = await fetchFromBaseUrl(baseUrl, user, token, timeoutMs);
      lastSuccess = {
        accounts,
        fetchedAt: new Date().toISOString(),
        baseUrl,
      };
      return exports.getCachedWHMAccountsMeta();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Failed to fetch WHM accounts");
};

exports.getWHMAccountsWithMeta = async () => {
  try {
    const host = whmConfig.host;
    const user = whmConfig.user;
    const token = whmConfig.token;
    if (!host || !user || !token) {
      throw new Error("WHM config missing (WHM_HOST/WHM_USER/WHM_TOKEN)");
    }

    const baseUrls = buildBaseUrls(host);
    let lastErr = null;
    for (const baseUrl of baseUrls) {
      try {
        const accounts = await fetchFromBaseUrl(baseUrl, user, token);
        lastSuccess = {
          accounts,
          fetchedAt: new Date().toISOString(),
          baseUrl,
        };
        return {
          accounts,
          cached: false,
          fetchedAt: lastSuccess.fetchedAt,
          baseUrl,
          error: null,
        };
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error("Failed to fetch WHM accounts");
  } catch (err) {
    const summary = getAxiosErrorSummary(err);
    const details = [
      summary.code ? `code=${summary.code}` : null,
      summary.status ? `status=${summary.status}` : null,
      summary.statusText ? `statusText=${summary.statusText}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const message = `Failed to fetch WHM accounts: ${summary.message}${
      details ? ` (${details})` : ""
    }`;

    if (Array.isArray(lastSuccess.accounts)) {
      return {
        accounts: lastSuccess.accounts,
        cached: true,
        fetchedAt: lastSuccess.fetchedAt,
        baseUrl: lastSuccess.baseUrl,
        error: message,
      };
    }

    throw new Error(message);
  }
};
