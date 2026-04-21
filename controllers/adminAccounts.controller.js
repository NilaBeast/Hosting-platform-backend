const HostingAccount = require("../models/HostingAccount");
const { getWHMAccounts } = require("../services/whmAccounts.service");

/* ===============================
   🔥 SYNC VIEW (WHM + DB)
================================ */
exports.getAccounts = async (req, res) => {
  try {
    const whmAccounts = await getWHMAccounts();

    const dbAccounts = await HostingAccount.findAll();

    const result = whmAccounts.map((whm) => {
      const match = dbAccounts.find(
        (db) => db.domain === whm.domain
      );

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

    res.json(result);
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