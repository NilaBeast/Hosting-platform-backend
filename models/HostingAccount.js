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
  recurring_amount: DataTypes.FLOAT,
  overdue_invoice_id: DataTypes.INTEGER,
  overdue_started_at: DataTypes.DATE,
  overdue_notice_count: DataTypes.INTEGER,
  last_overdue_notice_at: DataTypes.DATE,
  suspended_at: DataTypes.DATE,
  terminated_at: DataTypes.DATE,
});

module.exports = HostingAccount;
