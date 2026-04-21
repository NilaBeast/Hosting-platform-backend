const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");

const controller = require("../controllers/adminAccounts.controller");

router.get("/", auth, admin, controller.getAccounts);
router.post("/import", auth, admin, controller.importAccounts);

module.exports = router;