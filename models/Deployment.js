const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Deployment = sequelize.define("Deployment", {
  user_id: DataTypes.INTEGER,
  repo_url: DataTypes.STRING,
  branch: DataTypes.STRING,
  deploy_path: DataTypes.STRING,
  status: DataTypes.STRING,
  logs: DataTypes.TEXT,
  url: DataTypes.STRING,
  domain: DataTypes.STRING,
  cpanel_username: DataTypes.STRING,
});

module.exports = Deployment;