/* ===============================
   BASE WRAPPER (REUSABLE)
================================ */
const wrapper = (content) => `
  <div style="font-family: Arial, sans-serif; background:#f4f6f8; padding:20px;">
    <div style="max-width:600px; margin:auto; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 5px 15px rgba(0,0,0,0.1);">

      <!-- HEADER -->
      <div style="background:#4f46e5; color:white; padding:20px; text-align:center;">
        <h2 style="margin:0;">Support System</h2>
      </div>

      <!-- BODY -->
      <div style="padding:20px;">
        ${content}
      </div>

      <!-- FOOTER -->
      <div style="background:#f1f5f9; padding:15px; text-align:center; font-size:12px; color:#64748b;">
        © ${new Date().getFullYear()} Support System • All rights reserved
      </div>

    </div>
  </div>
`;

/* ===============================
   PRIORITY COLOR
================================ */
const getPriorityColor = (priority) => {
  switch (priority) {
    case "High":
      return "#dc2626";
    case "Medium":
      return "#f59e0b";
    case "Low":
      return "#16a34a";
    default:
      return "#6b7280";
  }
};

/* ===============================
   USER: NEW TICKET
================================ */
exports.newTicketUser = (ticket) => {
  return wrapper(`
    <h3 style="margin-top:0;">🎫 Ticket Created Successfully</h3>

    <p>Your support request has been received.</p>

    <div style="background:#f9fafb; padding:15px; border-radius:8px; margin:15px 0;">
      <p><b>Ticket ID:</b> ${ticket.ticket_id}</p>
      <p><b>Subject:</b> ${ticket.subject}</p>
      <p>
        <b>Priority:</b> 
        <span style="color:white; padding:4px 8px; border-radius:5px; background:${getPriorityColor(
          ticket.priority
        )}">
          ${ticket.priority}
        </span>
      </p>
    </div>

    <p>Our team will get back to you shortly.</p>
  `);
};

/* ===============================
   ADMIN: NEW TICKET (🔥 includes message)
================================ */
exports.newTicketAdmin = (ticket, message) => {
  return wrapper(`
    <h3 style="margin-top:0;">🚨 New Support Ticket</h3>

    <div style="background:#f9fafb; padding:15px; border-radius:8px; margin-bottom:15px;">
      <p><b>User:</b> ${ticket.client_name}</p>
      <p><b>Email:</b> ${ticket.client_email}</p>
      <p><b>Ticket ID:</b> ${ticket.ticket_id}</p>
      <p><b>Subject:</b> ${ticket.subject}</p>
      <p>
        <b>Priority:</b> 
        <span style="color:white; padding:4px 8px; border-radius:5px; background:${getPriorityColor(
          ticket.priority
        )}">
          ${ticket.priority}
        </span>
      </p>
    </div>

    <!-- 🔥 MESSAGE BODY -->
    <div style="border-left:4px solid #4f46e5; padding:15px; background:#f1f5f9; border-radius:6px;">
      <p style="margin:0; font-weight:bold;">User Message:</p>
      <div style="margin-top:10px;">
        ${message}
      </div>
    </div>
  `);
};

/* ===============================
   USER: REPLY RECEIVED
================================ */
exports.replyUser = (ticket, message) => {
  return wrapper(`
    <h3 style="margin-top:0;">📩 New Reply on Your Ticket</h3>

    <p>You have received a new response from our support team.</p>

    <div style="background:#f9fafb; padding:15px; border-radius:8px; margin-bottom:15px;">
      <p><b>Ticket ID:</b> ${ticket.ticket_id}</p>
      <p><b>Subject:</b> ${ticket.subject}</p>
    </div>

    <!-- 🔥 ADMIN MESSAGE -->
    <div style="border-left:4px solid #16a34a; padding:15px; background:#ecfdf5; border-radius:6px;">
      <p style="margin:0; font-weight:bold;">Reply:</p>
      <div style="margin-top:10px;">
        ${message}
      </div>
    </div>

    <p style="margin-top:20px;">Please login to respond.</p>
  `);
};