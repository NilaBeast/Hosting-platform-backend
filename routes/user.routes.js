const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const User = require("../models/User");

router.get("/profile", auth, async (req, res) => {
  const user = await User.findByPk(req.user.id);
  res.json(user);
});

module.exports = router;