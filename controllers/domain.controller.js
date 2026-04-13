const Domain = require("../models/Domain");
const HostingAccount = require("../models/HostingAccount");
const domainService = require("../services/domain.service");
const DomainPricing = require("../models/DomainPricing");

/* ===============================
   GET MARKETPLACE DOMAINS
================================ */
exports.getAvailableDomains = async (req, res) => {
  try {
    const domains = await DomainPricing.findAll({
      order: [
        ["is_spotlight", "DESC"],
        ["tld", "ASC"],
      ],
    });

    const data = domains.map((d) => {
      /* 🔥 SAFE VALUES */
      const regBase = Number(d.register_price || 0);
      const regMargin = Number(d.register_margin || 0);

      /* 🔥 FINAL PRICE LOGIC */
      let finalPrice = 0;

      if (regBase > 0) {
        finalPrice = regBase + regMargin;
      } else {
        // 🔥 FALLBACK (important)
        finalPrice = regMargin > 0 ? regMargin : 0;
      }

      return {
        id: d.id,
        tld: d.tld,
        tag: d.tag,
        is_spotlight: d.is_spotlight,

        base_price: regBase,
        margin: regMargin,
        final_price: finalPrice,

        currency: d.currency,

        /* 🔥 DEBUG (remove later) */
        debug: {
          base: regBase,
          margin: regMargin,
        },
      };
    });

    res.json(data);
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed");
  }
};
/* ===============================
   ADD DOMAIN (MANUAL ONLY)
================================ */
exports.addDomain = async (req, res) => {
  try {
    const { domain } = req.body;

    const newDomain = await Domain.create({
      user_id: req.user.id,
      domain,
      is_primary: false,
      is_selected: false,
      is_added_to_cpanel: false, // ✅ IMPORTANT
      type: "manual",
      status: "active",
    });

    res.json(newDomain);
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed to add domain");
  }
};

/* GET DOMAINS */
exports.getDomains = async (req, res) => {
  const domains = await Domain.findAll({
    where: { user_id: req.user.id },
    order: [
      ["is_selected", "DESC"],
      ["is_primary", "DESC"],
      ["createdAt", "ASC"],
    ],
  });

  res.json(domains);
};

/* SELECT DOMAIN */
exports.selectDomain = async (req, res) => {
  try {
    const { domainId } = req.body;

    await Domain.update(
      { is_selected: false },
      { where: { user_id: req.user.id } }
    );

    await Domain.update(
      { is_selected: true },
      {
        where: {
          id: domainId,
          user_id: req.user.id,
        },
      }
    );

    res.json({ message: "Domain selected" });
  } catch (err) {
    res.status(500).json("Failed to select domain");
  }
};

/* ===============================
   ADD TO CPANEL (BUTTON)
================================ */
exports.addToCpanel = async (req, res) => {
  try {
    const { domainId } = req.body;

    const domain = await Domain.findOne({
      where: { id: domainId, user_id: req.user.id },
    });

    if (!domain) return res.status(404).json("Domain not found");

    if (domain.is_added_to_cpanel) {
      return res.status(400).json("Already added");
    }

    const hosting = await HostingAccount.findOne({
      where: { user_id: req.user.id },
    });

    if (!hosting) {
      return res.status(400).json("No hosting account found");
    }

    await domainService.createAddonDomain(
      hosting.cpanel_username,
      domain.domain
    );

    domain.cpanel_username = hosting.cpanel_username;
    domain.is_added_to_cpanel = true;

    await domain.save();

    res.json({ message: "Domain added to cPanel" });
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed to add to cPanel");
  }
};

