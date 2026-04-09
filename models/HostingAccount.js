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
  status: DataTypes.STRING,
   login_url: DataTypes.TEXT,
});

module.exports = HostingAccount;