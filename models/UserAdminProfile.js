const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserAdminProfile = sequelize.define("UserAdminProfile", {
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  profile_json: {
    type: DataTypes.TEXT("long"),
    allowNull: true,
  },
  contacts_json: {
    type: DataTypes.TEXT("long"),
    allowNull: true,
  },
});

module.exports = UserAdminProfile;
