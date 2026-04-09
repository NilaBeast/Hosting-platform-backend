const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const InvoiceItem = sequelize.define("InvoiceItem", {
  invoice_id: DataTypes.INTEGER,
  description: DataTypes.STRING,
  qty: DataTypes.FLOAT,
  rate: DataTypes.FLOAT,
  amount: DataTypes.FLOAT,
});

module.exports = InvoiceItem;