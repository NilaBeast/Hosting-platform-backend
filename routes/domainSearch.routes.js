const router = require("express").Router();
const domainSearch = require("../controllers/domainSearch.controller");

/* CHECK DOMAIN */
router.get("/check", domainSearch.checkDomain);

/* BUY DOMAIN */
router.get("/buy", domainSearch.buyDomain);
router.post("/transfer", domainSearch.transferDomain);
module.exports = router;