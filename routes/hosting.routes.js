const router = require("express").Router();
const hosting = require("../controllers/hosting.controller");
const auth = require("../middlewares/auth.middleware");

router.post("/create", auth, hosting.createHosting);
router.get("/", auth, hosting.getMyHosting);
router.get("/login", auth, hosting.loginToCpanel);
module.exports = router;