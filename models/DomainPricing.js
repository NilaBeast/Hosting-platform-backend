const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

// DomainPricing model
const DomainPricing = sequelize.define("DomainPricing", {
  tld: {
    type: DataTypes.STRING,
    unique: true,
  },
  register_price: DataTypes.FLOAT,
  renew_price: DataTypes.FLOAT,
  transfer_price: DataTypes.FLOAT,

  is_custom: {
    type: DataTypes.BOOLEAN,
    defaultValue: false, // 🔥 IMPORTANT
  },

  currency: DataTypes.STRING,
});

module.exports = DomainPricing;