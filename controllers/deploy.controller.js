const deployService = require("../services/deploy.service");
const Deployment = require("../models/Deployment");
const HostingAccount = require("../models/HostingAccount");

exports.deploy = async (req, res) => {
  try {
    const { repo, domain } = req.body;
    const userId = req.user.id;

    if (!repo) {
      return res.status(400).json("Repository URL required");
    }

    // Get hosting account
    const account = await HostingAccount.findOne({
      where: { user_id: userId },
    });

    if (!account) {
      return res.status(400).json("Create hosting account first");
    }

    const result = await deployService.deployRepo(repo);

    const deployment = await Deployment.create({
      user_id: userId,
      repo_url: repo,
      branch: "main",
      deploy_path: result.path,
      status: "success",
      logs: result.logs.join("\n"),
      url: result.url,
      domain: domain || account.domain,
      cpanel_username: account.cpanel_username,
    });

    res.json({
      message: "Deployment Successful",
      logs: result.logs,
      url: result.url,
      deployment,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json("Deployment failed");
  }
};

exports.getDeployments = async (req, res) => {
  const deployments = await Deployment.findAll({
    where: { user_id: req.user.id },
    order: [["createdAt", "DESC"]],
  });

  res.json(deployments);
};