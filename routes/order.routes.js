const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");
const order = require("../controllers/order.controller");

router.post("/", auth, admin, order.createOrder);
router.get("/", auth, admin, order.getOrders);
router.get("/separate", auth, admin, order.getOrdersSeparated);
module.exports = router;