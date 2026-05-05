const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");

const {
  createPaymentOrder,
  createDomainOrder, // 🔥 NEW
  verifyPayment,
  payuCallback,
  getMyOrders,
} = require("../controllers/payment.controller");

/* ===============================
   HOSTING + DOMAIN ORDER
================================ */
router.post("/create-order", auth, createPaymentOrder);

/* ===============================
   🔥 DOMAIN ONLY ORDER (NEW)
================================ */
router.post("/create-domain-order", auth, createDomainOrder);

/* ===============================
   VERIFY PAYMENT
================================ */
router.post("/verify", auth, verifyPayment);

router.post("/payu/callback", payuCallback);

/* ===============================
   USER ORDERS
================================ */
router.get("/my-orders", auth, getMyOrders);

module.exports = router;
