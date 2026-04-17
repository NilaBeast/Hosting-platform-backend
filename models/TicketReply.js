const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TicketReply = sequelize.define("TicketReply", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  ticket_id: DataTypes.INTEGER,

  message: DataTypes.TEXT,

  sender_type: {
    type: DataTypes.STRING, // "user" or "admin"
  },

  user_id: DataTypes.INTEGER,
  admin_id: DataTypes.INTEGER,

  attachments: {
  type: DataTypes.TEXT, // JSON array
},

}, { timestamps: true });

module.exports = TicketReply;