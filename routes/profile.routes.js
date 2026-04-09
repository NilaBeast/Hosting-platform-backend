const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");
const profile = require("../controllers/profile.controller");

router.get("/", auth, profile.getProfile);
router.put("/", auth, upload.single("avatar"), profile.updateProfile);

module.exports = router;