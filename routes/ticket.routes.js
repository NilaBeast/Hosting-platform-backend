const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const admin = require("../middlewares/admin.middleware");
const ctrl = require("../controllers/ticket.controller");
const upload = require("../middlewares/ticketUpload.middleware");

/* ===============================
   USER CREATE TICKET (WITH FILES)
================================ */
router.post("/", auth, upload.array("attachments"), ctrl.createTicket);

/* USER */
router.get("/my", auth, ctrl.getMyTickets);

/* ADMIN */
router.get("/admin", auth, admin, ctrl.getAllTickets);

/* COMMON */
router.get("/:id", auth, ctrl.getTicketById);

/* REPLY (WITH FILES ALSO) */
router.post(
  "/:id/reply",
  auth,
  upload.array("attachments"),
  ctrl.replyTicket
);

/* CLOSE */
router.post("/:id/close", auth, ctrl.closeTicket);

module.exports = router;