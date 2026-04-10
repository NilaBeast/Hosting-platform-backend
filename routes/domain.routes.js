const router = require("express").Router();
const domain = require("../controllers/domain.controller");
const auth = require("../middlewares/auth.middleware");

router.get("/list", domain.getAvailableDomains);
router.post("/select", auth, domain.selectDomain);
router.get("/", auth, domain.getDomains);
router.post("/add", auth, domain.addDomain);
router.post("/add-to-cpanel", auth, domain.addToCpanel);
module.exports = router;