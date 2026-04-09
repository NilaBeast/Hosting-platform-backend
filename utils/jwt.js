const jwt = require("jsonwebtoken");

exports.generateToken = (user) => {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET);
};