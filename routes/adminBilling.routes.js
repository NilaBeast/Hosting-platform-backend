const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");
const billing = require("../controllers/adminBilling.controller");

router.get("/transactions", auth, admin, billing.getTransactions);

module.exports = router;