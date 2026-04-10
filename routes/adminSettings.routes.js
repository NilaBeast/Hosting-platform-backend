const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");

const controller = require("../controllers/adminSettings.controller");

router.get("/package-pricing", auth, admin, controller.getPackagePricing);

router.post("/package-pricing", auth, admin, controller.updatePackagePricing);

module.exports = router;