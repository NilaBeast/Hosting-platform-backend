const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const HostingAccount = sequelize.define("HostingAccount", {
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  cpanel_username: DataTypes.STRING,
  domain: DataTypes.STRING,
  email: DataTypes.STRING,
  password: DataTypes.STRING,
  service_name: DataTypes.STRING,
  billing_cycle: DataTypes.STRING,
  next_due_date: DataTypes.DATE,
  status: DataTypes.STRING,
   login_url: DataTypes.TEXT,
});

module.exports = HostingAccount;
