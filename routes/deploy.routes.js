const router = require("express").Router();
const deploy = require("../controllers/deploy.controller");
const auth = require("../middlewares/auth.middleware");

router.post("/", auth, deploy.deploy);
router.get("/", auth, deploy.getDeployments);

module.exports = router;