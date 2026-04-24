const router = require("express").Router();
const admin = require("../middlewares/admin.middleware");
const auth = require("../middlewares/auth.middleware");
const adminController = require("../controllers/admin.controller");
const orderController = require("../controllers/order.controller");

const bcrypt = require("bcrypt");
const User = require("../models/User");

/* USERS */
router.post("/users", auth, admin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(400).json("Email already exists");

    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hash,
      role: role || "user",
    });

    res.json(user);
  } catch (err) {
    res.status(500).json(err.message);
  }
});

/* DELETE USER */
router.delete("/users/:id", auth, admin, async (req, res) => {
  await User.destroy({ where: { id: req.params.id } });
  res.json({ message: "User deleted" });
});

/* UPDATE USER */
router.put("/users/:id", auth, admin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json("User not found");

    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      user.password = hash;
    }

    await user.save();

    res.json(user);
  } catch (err) {
    res.status(500).json(err.message);
  }
});

router.get("/users/:id", auth, admin, adminController.getUserDetails);

router.put("/users/:id/details", auth, admin, adminController.updateUserDetails);

/* DASHBOARD */
router.get("/dashboard", auth, admin, adminController.getDashboardStats);

/* USERS */
router.get("/users", auth, admin, adminController.getAllUsers);

/* ORDERS */
router.get("/orders", auth, admin, orderController.getOrders);

/* CREATE ORDER */
router.post("/orders/create", auth, admin, orderController.createOrder);

/* REGISTER DOMAIN BUTTON */
router.post(
  "/orders/register-domain",
  auth,
  admin,
  adminController.registerDomain
);

/* DEPLOYMENTS */
router.get("/deployments", auth, admin, adminController.getAllDeployments);

module.exports = router;
