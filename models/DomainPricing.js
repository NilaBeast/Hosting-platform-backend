const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DomainPricing = sequelize.define("DomainPricing", {
  tld: {
    type: DataTypes.STRING,
    unique: true,
  },
  register_price: DataTypes.FLOAT,
  renew_price: DataTypes.FLOAT,
  transfer_price: DataTypes.FLOAT,
  currency: DataTypes.STRING,
});

module.exports = DomainPricing;