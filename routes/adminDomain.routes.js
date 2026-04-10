const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");
const controller = require("../controllers/adminDomain.controller");

router.get("/", auth, admin, controller.getDomainPricing);

router.post("/margins", auth, admin, controller.updateMargins);
router.post("/tag", auth, admin, controller.updateTag);
router.post("/spotlight", auth, admin, controller.toggleSpotlight);
router.post("/advanced-pricing", auth, admin, controller.updateAdvancedPricing);

module.exports = router;