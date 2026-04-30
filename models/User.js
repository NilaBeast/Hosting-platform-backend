const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define("User", {
  name: DataTypes.STRING,
  email: {
    type: DataTypes.STRING,
    unique: true,
  },
  company: DataTypes.STRING,
  phone: DataTypes.STRING,
  address1: DataTypes.STRING,
  address2: DataTypes.STRING,
  city: DataTypes.STRING,
  state: DataTypes.STRING,
  postcode: DataTypes.STRING,
  country: DataTypes.STRING,
  password: DataTypes.STRING,
  firebase_uid: DataTypes.STRING,
  avatar: DataTypes.STRING,
  role: {
    type: DataTypes.STRING,
    defaultValue: "user",
  },
});

module.exports = User;
