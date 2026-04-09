const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Domain = sequelize.define("Domain", {
  user_id: DataTypes.INTEGER,
  domain: DataTypes.STRING,
  cpanel_username: DataTypes.STRING,

  is_primary: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },

  is_selected: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },

  is_added_to_cpanel: {   // ✅ NEW
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },

  type: {   // ✅ NEW (register / transfer / existing)
    type: DataTypes.STRING,
  },

  status: DataTypes.STRING,
});

module.exports = Domain;