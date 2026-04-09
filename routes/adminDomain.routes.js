const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");
const controller = require("../controllers/adminDomain.controller");

router.get("/", auth, admin, controller.getDomainPricing);
router.post("/update", auth, admin, controller.updateDomainPricing);

module.exports = router;