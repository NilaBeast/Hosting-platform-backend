const Ticket = require("../models/Ticket");
const TicketReply = require("../models/TicketReply");
const User = require("../models/User");

/* ===============================
   GENERATE TICKET ID
================================ */
function generateTicketId() {
  return "TCK-" + Math.floor(100000 + Math.random() * 900000);
}

/* ===============================
   CREATE TICKET (FIXED 🔥)
================================ */
exports.createTicket = async (req, res) => {
  try {
    const {
      subject,
      message,
      department,
      priority,
      user_id,
      cc_recipients,
    } = req.body;

    /* ===============================
       VALIDATION
    ============================== */
    if (!subject || !message) {
      return res.status(400).json("Subject & message required");
    }

    /* ===============================
       RESOLVE USER
    ============================== */
    let finalUser = null;

    if (req.user.role === "admin" && user_id) {
      finalUser = await User.findByPk(user_id);
    }

    if (!finalUser) {
      finalUser = await User.findByPk(req.user.id);
    }

    if (!finalUser) {
      return res.status(400).json("User not found");
    }

    /* ===============================
       PRIORITY FIX 🔥
    ============================== */
    const validPriorities = ["Low", "Medium", "High"];

    const finalPriority = validPriorities.includes(priority)
      ? priority
      : "Medium";

    /* ===============================
       FILES
    ============================== */
    const files = req.files || [];
    const attachments = files.map((f) =>
  `uploads/tickets/${f.filename}`
); // 🔥 Cloudinary URL

    /* ===============================
       CREATE TICKET
    ============================== */
    const ticket = await Ticket.create({
      ticket_id: generateTicketId(),
      subject,
      department: department || "General Enquiries",
      priority: finalPriority, // ✅ FIXED

      user_id: finalUser.id,
      admin_id: req.user.role === "admin" ? req.user.id : null,

      client_name: finalUser.name,
      client_email: finalUser.email,

      cc_recipients,
      status: "Open",
    });

    await TicketReply.create({
      ticket_id: ticket.id,
      message,
      sender_type: req.user.role === "admin" ? "admin" : "user",
      user_id: req.user.id,
      admin_id: req.user.role === "admin" ? req.user.id : null,
      attachments: JSON.stringify(attachments),
    });

    res.json(ticket);
  } catch (err) {
    console.error("CREATE TICKET ERROR:", err);
    res.status(500).json("Server Error");
  }
};

/* ===============================
   GET ALL TICKETS (ADMIN)
================================ */
exports.getAllTickets = async (req, res) => {
  try {
    const tickets = await Ticket.findAll({
      include: [
        {
          model: User,
          attributes: ["id", "name", "email"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json(tickets);
  } catch (err) {
    console.error("GET ALL TICKETS ERROR:", err);
    res.status(500).json("Error fetching tickets");
  }
};

/* ===============================
   GET USER TICKETS
================================ */
exports.getMyTickets = async (req, res) => {
  try {
    const tickets = await Ticket.findAll({
      where: { user_id: req.user.id },
      order: [["createdAt", "DESC"]],
    });

    res.json(tickets);
  } catch (err) {
    console.error("GET MY TICKETS ERROR:", err);
    res.status(500).json("Error fetching tickets");
  }
};

/* ===============================
   GET SINGLE TICKET
================================ */
exports.getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findByPk(req.params.id, {
      include: [
        {
          model: TicketReply,
          separate: true,
          order: [["createdAt", "ASC"]],
        },
        {
          model: User,
          attributes: ["id", "name", "email"],
        },
      ],
    });

    if (!ticket) {
      return res.status(404).json("Ticket not found");
    }

    res.json(ticket);
  } catch (err) {
    console.error("GET TICKET ERROR:", err);
    res.status(500).json("Error fetching ticket");
  }
};

/* ===============================
   REPLY (FIX EMPTY MESSAGE 🔥)
================================ */
exports.replyTicket = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message === "<br>") {
      return res.status(400).json("Message required");
    }

    const files = req.files || [];
    const attachments = files.map((f) =>
  `uploads/tickets/${f.filename}`
); // 🔥 Cloudinary URL

    const reply = await TicketReply.create({
      ticket_id: req.params.id,
      message,
      sender_type: req.user.role === "admin" ? "admin" : "user",
      user_id: req.user.id,
      admin_id: req.user.role === "admin" ? req.user.id : null,
      attachments: JSON.stringify(attachments),
    });

    await Ticket.update(
      { status: "Answered" },
      { where: { id: req.params.id } }
    );

    res.json(reply);
  } catch (err) {
    console.error("REPLY ERROR:", err);
    res.status(500).json("Reply failed");
  }
};

/* ===============================
   CLOSE TICKET
================================ */
exports.closeTicket = async (req, res) => {
  try {
    await Ticket.update(
      { status: "Closed" },
      { where: { id: req.params.id } }
    );

    res.json({ message: "Ticket Closed" });
  } catch (err) {
    console.error("CLOSE ERROR:", err);
    res.status(500).json("Error closing ticket");
  }
};