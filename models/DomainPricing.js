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

  /* 🔥 NEW MARGINS (FLAT ₹ / $) */
  register_margin: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  renew_margin: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  transfer_margin: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },

  tag: {
    type: DataTypes.STRING,
  },

  is_spotlight: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },

  pricing_json: {
    type: DataTypes.JSON,
  },
});

module.exports = DomainPricing;