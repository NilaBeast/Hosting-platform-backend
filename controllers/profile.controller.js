const User = require("../models/User");

/* ===============================
   GET PROFILE
================================ */
exports.getProfile = async (req, res) => {
  const user = await User.findByPk(req.user.id);
  res.json(user);
};

/* ===============================
   UPDATE PROFILE
================================ */
exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

    const user = await User.findByPk(req.user.id);

    if (name) user.name = name;
    if (email) user.email = email;

    if (req.file) {
      user.avatar = req.file.path;
    }

    await user.save();

    res.json(user);
  } catch (err) {
    res.status(500).json(err.message);
  }
};