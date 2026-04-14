// models/ProductGroup.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ProductGroup = sequelize.define("ProductGroup", {
  name: DataTypes.STRING,
  headline: DataTypes.STRING,
  tagline: DataTypes.STRING,
  is_hidden: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  slug: {
  type: DataTypes.STRING,
  unique: true,
},
});

module.exports = ProductGroup;