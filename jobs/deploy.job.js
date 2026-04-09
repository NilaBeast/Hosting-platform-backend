const Queue = require("bull");
const deployService = require("../services/deploy.service");

const deployQueue = new Queue("deploy");

deployQueue.process(async (job) => {
  await deployService.deployRepo(job.data.repoUrl, job.data.ftp);
});

module.exports = deployQueue;