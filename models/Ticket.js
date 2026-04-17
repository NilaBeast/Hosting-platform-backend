const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Ticket = sequelize.define("Ticket", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  ticket_id: {
    type: DataTypes.STRING,
    unique: true,
  },

  subject: DataTypes.STRING,

  department: DataTypes.STRING,
  priority: DataTypes.STRING,

  status: {
    type: DataTypes.STRING,
    defaultValue: "Open",
  },

  user_id: DataTypes.INTEGER,
  admin_id: DataTypes.INTEGER,

  client_name: DataTypes.STRING,
  client_email: DataTypes.STRING,

  cc_recipients: DataTypes.TEXT, // comma separated

}, { timestamps: true });

module.exports = Ticket;