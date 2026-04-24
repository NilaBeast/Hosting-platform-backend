const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const EmailLog = sequelize.define("EmailLog", {
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  direction: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "outgoing",
  },
  source: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "platform",
  },
  legacy_key: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  from_email: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  to_email: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  subject: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  body_text: {
    type: DataTypes.TEXT("long"),
    allowNull: true,
  },
  body_html: {
    type: DataTypes.TEXT("long"),
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "sent",
  },
  error_message: {
    type: DataTypes.TEXT("long"),
    allowNull: true,
  },
  provider_message_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  meta_json: {
    type: DataTypes.TEXT("long"),
    allowNull: true,
  },
});

module.exports = EmailLog;
