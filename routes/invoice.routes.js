const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");
const invoice = require("../controllers/invoice.controller");

/* ===============================
   ADMIN - GET ALL INVOICES
================================ */
router.get("/", auth, admin, invoice.getInvoices);

/* ===============================
   ADMIN - CREATE CUSTOM INVOICE
================================ */
router.post("/create", auth, admin, invoice.createInvoice);

/* ===============================
   GET SINGLE INVOICE
================================ */
router.get("/:id", auth, admin, invoice.getInvoiceById);

/* ===============================
   DOWNLOAD INVOICE PDF
================================ */
router.get("/download/:id", auth, admin, invoice.downloadInvoice);

/* ===============================
   RESEND INVOICE EMAIL
================================ */
router.post("/send/:id", auth, admin, invoice.sendInvoiceMailAgain);

module.exports = router;