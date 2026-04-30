const HostingAccount = require("../models/HostingAccount");
const {
  getCachedWHMAccountsMeta,
  refreshWHMAccountsCache,
} = require("../services/whmAccounts.service");

/* ===============================
   🔥 SYNC VIEW (WHM + DB)
================================ */
exports.getAccounts = async (req, res) => {
  try {
    const dbAccounts = await HostingAccount.findAll();

    const cached = getCachedWHMAccountsMeta();

    const refreshPromise = refreshWHMAccountsCache({
      timeoutMs: Number(process.env.WHM_ACCOUNTS_REFRESH_TIMEOUT_MS || 8000),
    });

    const fastResult = await Promise.race([
      refreshPromise
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, error: e?.message || "Failed to fetch WHM accounts" })),
      new Promise((r) => setTimeout(() => r({ ok: null }), 2500)),
    ]);

    const cachedAfter =
      fastResult.ok === true ? getCachedWHMAccountsMeta() : cached;

    if (cachedAfter && Array.isArray(cachedAfter.accounts)) {
      const accounts = cachedAfter.accounts.map((whm) => {
        const match = dbAccounts.find((db) => db.domain === whm.domain);
        return {
          domain: whm.domain,
          username: whm.user,
          ip: whm.ip,
          plan: whm.plan,
          created: whm.startdate,
          existsInDB: !!match,
          dbId: match?.id || null,
        };
      });

      return res.json({
        accounts,
        whmError: fastResult.ok === false ? fastResult.error : null,
        whmCached: fastResult.ok !== true,
        whmFetchedAt: cachedAfter.fetchedAt || null,
        whmBaseUrl: cachedAfter.baseUrl || null,
      });
    }

    refreshPromise.catch(() => {});

    const accounts = dbAccounts.map((db) => ({
      domain: db.domain,
      username: db.cpanel_username || "-",
      ip: db.ip_address || db.ip || "-",
      plan: db.plan || "-",
      created: db.createdAt || null,
      existsInDB: true,
      dbId: db.id,
    }));

    return res.json({
      accounts,
      whmError:
        fastResult.ok === false
          ? fastResult.error
          : "WHM is slow/unreachable, showing DB accounts",
      whmCached: true,
      whmFetchedAt: null,
      whmBaseUrl: null,
    });
  } catch (err) {
    res.status(500).json(err.message);
  }
};

/* ===============================
   🔥 IMPORT ACCOUNTS
================================ */
exports.importAccounts = async (req, res) => {
  try {
    const { accounts } = req.body;

    const created = [];

    for (const acc of accounts) {
      const exists = await HostingAccount.findOne({
        where: { domain: acc.domain },
      });

      if (!exists) {
        const newAcc = await HostingAccount.create({
          user_id: req.user.id, // admin importing
          cpanel_username: acc.username,
          domain: acc.domain,
          email: "",
          password: "",
          status: "active",
          login_url: "",
        });

        created.push(newAcc);
      }
    }

    res.json({
      message: "Accounts imported",
      count: created.length,
    });
  } catch (err) {
    res.status(500).json(err.message);
  }
};
