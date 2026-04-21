// models/Product.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Product = sequelize.define("Product", {
  name: DataTypes.STRING,
  description: DataTypes.TEXT,
  short_description: DataTypes.STRING,

  whm_package_name: DataTypes.STRING,

  price: DataTypes.FLOAT,

  pricing_json: {
    type: DataTypes.JSON,
    allowNull: true,
  },

  upgrades: {
  type: DataTypes.JSON,
  allowNull: true,
},

free_domain_type: {
  type: DataTypes.STRING,
  defaultValue: "none",
},

slug: {
  type: DataTypes.STRING,
  unique: true,
},
short_description: DataTypes.TEXT,

free_domain_tlds: {
  type: DataTypes.JSON,
  allowNull: true,
},

product_group_id: {
  type: DataTypes.INTEGER,
  allowNull: false,
},

  is_hidden: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
});

module.exports = Product;