const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Invoice = sequelize.define("Invoice", {
  user_id: DataTypes.INTEGER,
  order_id: DataTypes.INTEGER,
  hosting_account_id: DataTypes.INTEGER,
  invoice_number: DataTypes.STRING,
  customer_name: DataTypes.STRING,
  email: DataTypes.STRING,
  amount: DataTypes.FLOAT,
  status: DataTypes.STRING,
  due_date: DataTypes.DATE,
  invoice_type: DataTypes.STRING,
  meta_json: DataTypes.TEXT("long"),
  pdf_path: DataTypes.STRING,
});

module.exports = Invoice;
