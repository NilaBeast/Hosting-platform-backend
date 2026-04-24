const Ticket = require("../models/Ticket");
const TicketReply = require("../models/TicketReply");
const User = require("../models/User");
const EmailLog = require("../models/EmailLog");

const transporter = require("../utils/mailer");
const {
  newTicketUser,
  newTicketAdmin,
  replyUser,
} = require("../utils/ticketMail");

/* ===============================
   GENERATE TICKET ID
================================ */
function generateTicketId() {
  return "TCK-" + Math.floor(100000 + Math.random() * 900000);
}

/* ===============================
   CREATE TICKET
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

    if (!subject || !message) {
      return res.status(400).json("Subject & message required");
    }

    /* USER RESOLVE */
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

    /* PRIORITY FIX */
    const validPriorities = ["Low", "Medium", "High"];
    const finalPriority = validPriorities.includes(priority)
      ? priority
      : "Medium";

    /* FILES */
    const files = req.files || [];
    const attachments = files.map(
      (f) => `uploads/tickets/${f.filename}`
    );

    /* CREATE */
    const ticket = await Ticket.create({
      ticket_id: generateTicketId(),
      subject,
      department: department || "General Enquiries",
      priority: finalPriority,

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

    const userMail = {
      from: process.env.MAIL_USER,
      to: finalUser.email,
      subject: `Ticket Created - ${ticket.ticket_id}`,
      html: newTicketUser(ticket),
    };

    try {
      const info = await transporter.sendMail(userMail);
      try {
        await EmailLog.create({
          user_id: finalUser.id,
          direction: "outgoing",
          source: "platform",
          from_email: process.env.MAIL_USER || null,
          to_email: finalUser.email,
          subject: userMail.subject || null,
          body_html: userMail.html || null,
          body_text: null,
          status: "sent",
          provider_message_id: info?.messageId || null,
          meta_json: JSON.stringify({ type: "ticket_created", ticket_id: ticket.ticket_id }),
        });
      } catch (e) {
        console.log("EMAIL LOG ERROR:", e?.message || e);
      }
    } catch (mailErr) {
      try {
        await EmailLog.create({
          user_id: finalUser.id,
          direction: "outgoing",
          source: "platform",
          from_email: process.env.MAIL_USER || null,
          to_email: finalUser.email,
          subject: userMail.subject || null,
          body_html: userMail.html || null,
          body_text: null,
          status: "failed",
          error_message: mailErr?.message || String(mailErr),
          meta_json: JSON.stringify({ type: "ticket_created", ticket_id: ticket.ticket_id }),
        });
      } catch (e) {
        console.log("EMAIL LOG ERROR:", e?.message || e);
      }
      console.error("MAIL ERROR:", mailErr.message);
    }

    try {
      await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: process.env.ADMIN_EMAIL,
        subject: `New Ticket - ${ticket.ticket_id}`,
        html: newTicketAdmin(ticket, message),
      });
    } catch (mailErr) {
      console.error("MAIL ERROR:", mailErr.message);
    }

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
  const tickets = await Ticket.findAll({
    include: [{ model: User, attributes: ["id", "name", "email"] }],
    order: [["createdAt", "DESC"]],
  });

  res.json(tickets);
};

/* ===============================
   GET USER TICKETS
================================ */
exports.getMyTickets = async (req, res) => {
  const tickets = await Ticket.findAll({
    where: { user_id: req.user.id },
    order: [["createdAt", "DESC"]],
  });

  res.json(tickets);
};

/* ===============================
   GET SINGLE
================================ */
exports.getTicketById = async (req, res) => {
  const ticket = await Ticket.findByPk(req.params.id, {
    include: [
      { model: TicketReply, separate: true, order: [["createdAt", "ASC"]] },
      { model: User, attributes: ["id", "name", "email"] },
    ],
  });

  if (!ticket) return res.status(404).json("Ticket not found");

  res.json(ticket);
};

/* ===============================
   REPLY
================================ */
exports.replyTicket = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message === "<br>") {
      return res.status(400).json("Message required");
    }

    const files = req.files || [];
    const attachments = files.map(
      (f) => `uploads/tickets/${f.filename}`
    );

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

    if (req.user.role === "admin") {
      const ticket = await Ticket.findByPk(req.params.id);

      const replyMail = {
        from: process.env.MAIL_USER,
        to: ticket.client_email,
        subject: `New Reply - ${ticket.ticket_id}`,
        html: replyUser(ticket, message),
      };

      try {
        const info = await transporter.sendMail(replyMail);
        try {
          await EmailLog.create({
            user_id: ticket.user_id || null,
            direction: "outgoing",
            source: "platform",
            from_email: process.env.MAIL_USER || null,
            to_email: ticket.client_email,
            subject: replyMail.subject || null,
            body_html: replyMail.html || null,
            body_text: null,
            status: "sent",
            provider_message_id: info?.messageId || null,
            meta_json: JSON.stringify({ type: "ticket_reply", ticket_id: ticket.ticket_id }),
          });
        } catch (e) {
          console.log("EMAIL LOG ERROR:", e?.message || e);
        }
      } catch (mailErr) {
        try {
          await EmailLog.create({
            user_id: ticket.user_id || null,
            direction: "outgoing",
            source: "platform",
            from_email: process.env.MAIL_USER || null,
            to_email: ticket.client_email,
            subject: replyMail.subject || null,
            body_html: replyMail.html || null,
            body_text: null,
            status: "failed",
            error_message: mailErr?.message || String(mailErr),
            meta_json: JSON.stringify({ type: "ticket_reply", ticket_id: ticket.ticket_id }),
          });
        } catch (e) {
          console.log("EMAIL LOG ERROR:", e?.message || e);
        }
        console.error("MAIL ERROR:", mailErr.message);
      }
    }

    res.json(reply);
  } catch (err) {
    console.error("REPLY ERROR:", err);
    res.status(500).json("Reply failed");
  }
};

/* ===============================
   CLOSE
================================ */
exports.closeTicket = async (req, res) => {
  await Ticket.update(
    { status: "Closed" },
    { where: { id: req.params.id } }
  );

  res.json({ message: "Ticket Closed" });
};
