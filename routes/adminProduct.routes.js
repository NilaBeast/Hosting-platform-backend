// routes/adminProduct.routes.js
const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");

const controller = require("../controllers/adminProduct.controller");

/* GROUPS */
router.post("/group", auth, admin, controller.createGroup);
router.get("/groups",  controller.getGroups);
router.put("/group/:id", auth, admin, controller.updateGroup);
router.delete("/group/:id", auth, admin, controller.deleteGroup);

router.get("/group/:groupId/products", controller.getProductsByGroup);
router.get("/product/:productId/plans", controller.getPlansByProduct);

/* PRODUCTS */
router.post("/product", auth, admin, controller.createProduct);
router.get("/products", auth, admin, controller.getProducts);
router.put("/product/:id", auth, admin, controller.updateProduct);
router.delete("/product/:id", auth, admin, controller.deleteProduct);
router.get("/store/:groupSlug/:productSlug", controller.getProductBySlug);
module.exports = router;