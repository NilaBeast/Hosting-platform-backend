const whmService = require("../services/whm.service");
const HostingAccount = require("../models/HostingAccount");
const Domain = require("../models/Domain");
function generateStrongPassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

exports.createHosting = async (req, res) => {
  try {
    let { username, domain, password, email } = req.body;

    const result = await whmService.createAccountWithSession({
      username,
      domain,
      password,
      email,
    });

    const account = await HostingAccount.create({
      user_id: req.user.id,
      cpanel_username: result.username,
      domain: result.domain,
      password: result.password,
      login_url: result.loginUrl,
      status: "active",
    });

    await Domain.create({
  user_id: req.user.id,
  domain: result.domain,
  cpanel_username: result.username,
  is_primary: true,
  status: "active",
});

    res.json({
      message: "Hosting Account Created",
      account,
      cpanelLogin: result.loginUrl,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json("WHM account creation failed");
  }
};

exports.getMyHosting = async (req, res) => {
  const account = await HostingAccount.findOne({
    where: { user_id: req.user.id },
  });

  res.json(account);
};

exports.loginToCpanel = async (req, res) => {
  try {
    const account = await HostingAccount.findOne({
      where: { user_id: req.user.id },
    });

    if (!account) {
      return res.status(404).json("Hosting account not found");
    }

    const loginUrl = await whmService.createCpanelSession(
      account.cpanel_username
    );

    res.json({ url: loginUrl });
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed to create cPanel login session");
  }
};