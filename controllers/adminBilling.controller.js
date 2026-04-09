const Order = require("../models/Order");
const User = require("../models/User");
const Plan = require("../models/Plan");

exports.getTransactions = async (req, res) => {
  try {
    const transactions = await Order.findAll({
      include: [
        {
          model: User,
          attributes: ["id", "name", "email"],
        },
        {
          model: Plan,
          attributes: ["name"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json(transactions);
  } catch (err) {
    res.status(500).json(err.message);
  }
};