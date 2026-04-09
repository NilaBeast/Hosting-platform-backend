const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Plan = sequelize.define("Plan", {
  name: DataTypes.STRING,
  whm_package_name: {
    type: DataTypes.STRING,
    unique: true,
  },

  disk: DataTypes.INTEGER,
  bandwidth: DataTypes.INTEGER,

  max_ftp: DataTypes.INTEGER,
  max_email: DataTypes.INTEGER,
  max_db: DataTypes.INTEGER,
  max_subdomain: DataTypes.INTEGER,
  max_addon_domain: DataTypes.INTEGER,
  max_parked_domain: DataTypes.INTEGER,
  max_passenger_apps: DataTypes.INTEGER,

  hourly_email: DataTypes.INTEGER,
  email_quota: DataTypes.INTEGER,
  mailing_lists: DataTypes.INTEGER,
  team_users: DataTypes.INTEGER,

  price: DataTypes.FLOAT,
});

module.exports = Plan;