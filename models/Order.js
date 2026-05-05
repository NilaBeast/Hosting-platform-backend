const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Order = sequelize.define("Order", {
  user_id: DataTypes.INTEGER,
  plan_id: DataTypes.INTEGER,
  domain: DataTypes.STRING,
  billing_cycle: DataTypes.STRING,

  plan_price: DataTypes.FLOAT,
  domain_price: DataTypes.FLOAT,
  total_price: DataTypes.FLOAT,

  status: {
    type: DataTypes.STRING,
    defaultValue: "pending", // pending / paid / failed
  },

  domain_status: {
    type: DataTypes.STRING,
    defaultValue: "pending", // pending / registered
  },

  payment_gateway: DataTypes.STRING,

  payment_session_id: DataTypes.STRING,
  razorpay_order_id: DataTypes.STRING,
  razorpay_payment_id: DataTypes.STRING,
  razorpay_signature: DataTypes.STRING,
type: DataTypes.STRING, // 🔥 ADD THIS
  payment_id: DataTypes.STRING,
  payment_method: DataTypes.STRING,
  payment_amount: DataTypes.FLOAT,
  payment_status: DataTypes.STRING,

  cpanel_username: DataTypes.STRING,
});

module.exports = Order;
