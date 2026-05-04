const nodemailer = require("nodemailer");
const path = require("path");
const EmailLog = require("../models/EmailLog");

/* ===============================
   MAIL TRANSPORTER (GMAIL)
================================ */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

/* ===============================
   SEND INVOICE MAIL
================================ */
exports.sendInvoiceMail = async (userId, toEmail, pdfPath) => {
  try {
    // Convert relative path to absolute path
    const absolutePath = path.join(
      __dirname,
      "../../",
      pdfPath
    );

    const mailOptions = {
      from: `"Techzuno Billing" <${process.env.MAIL_USER}>`,
      to: toEmail,
      subject: "Invoice - Techzuno Hosting",
      html: `
      <div style="font-family: Arial; background:#f4f6f8; padding:20px">
        <div style="max-width:600px; margin:auto; background:white; padding:30px; border-radius:8px">
          <h2 style="color:#111">Payment Successful</h2>
          <p>Your hosting account has been activated successfully.</p>

          <div style="background:#f1f5f9; padding:15px; border-radius:6px; margin-top:15px">
            <p><b>Invoice Attached</b></p>
            <p>Please download your invoice from attachment.</p>
          </div>

          <br/>
          <p>Regards,<br/>Techzuno Solutions</p>
        </div>
      </div>
      `,
      attachments: [
        {
          filename: path.basename(pdfPath),
          path: absolutePath,
        },
      ],
    };

    const info = await transporter.sendMail(mailOptions);

    try {
      await EmailLog.create({
        user_id: userId || null,
        direction: "outgoing",
        source: "platform",
        from_email: process.env.MAIL_USER || null,
        to_email: toEmail,
        subject: mailOptions.subject || null,
        body_html: mailOptions.html || null,
        body_text: null,
        status: "sent",
        provider_message_id: info?.messageId || null,
        meta_json: JSON.stringify({
          type: "invoice",
          hasAttachment: true,
          attachment: path.basename(pdfPath),
        }),
      });
    } catch (e) {
      console.log("EMAIL LOG ERROR:", e?.message || e);
    }

    console.log("Invoice mail sent to:", toEmail);
  } catch (err) {
    try {
      await EmailLog.create({
        user_id: userId || null,
        direction: "outgoing",
        source: "platform",
        from_email: process.env.MAIL_USER || null,
        to_email: toEmail,
        subject: "Invoice - Techzuno Hosting",
        body_html: null,
        body_text: null,
        status: "failed",
        error_message: err?.message || String(err),
      });
    } catch (e) {
      console.log("EMAIL LOG ERROR:", e?.message || e);
    }
    console.log("MAIL ERROR:", err);
  }
};

exports.sendBillingReminderMail = async (
  userId,
  toEmail,
  pdfPath,
  opts = {}
) => {
  const subject = opts.subject || "Payment Reminder - Techzuno Hosting";
  const legacyKey = opts.legacy_key || null;
  const nextDueDate = opts.next_due_date ? new Date(opts.next_due_date) : null;
  const amount = typeof opts.amount === "number" ? opts.amount : Number(opts.amount || 0) || 0;
  const title = opts.title || "Upcoming Payment Reminder";
  const message = opts.message || "Your service is due for renewal.";
  const severity = opts.severity || "info";

  try {
    if (legacyKey) {
      const exists = await EmailLog.findOne({ where: { legacy_key: legacyKey } });
      if (exists) return;
    }

    const absolutePath = path.join(__dirname, "../../", pdfPath);

    const badgeColor =
      severity === "danger"
        ? "#dc2626"
        : severity === "warning"
          ? "#f59e0b"
          : "#2563eb";

    const mailOptions = {
      from: `"Techzuno Billing" <${process.env.MAIL_USER}>`,
      to: toEmail,
      subject,
      html: `
      <div style="font-family: Arial; background:#0b1220; padding:20px">
        <div style="max-width:620px; margin:auto; background:#0f172a; padding:28px; border-radius:12px; border:1px solid rgba(148,163,184,0.18)">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px">
            <h2 style="color:#ffffff; margin:0">${title}</h2>
            <span style="font-size:12px; padding:6px 10px; border-radius:999px; background:${badgeColor}; color:#fff">Billing</span>
          </div>
          <p style="color:#cbd5e1; margin-top:14px; line-height:1.6">${message}</p>
          <div style="background:rgba(2,6,23,0.55); padding:14px; border-radius:10px; border:1px solid rgba(148,163,184,0.14); margin-top:14px">
            <p style="margin:0; color:#e2e8f0"><b>Amount Due:</b> ₹${amount.toFixed(2)}</p>
            <p style="margin:6px 0 0; color:#e2e8f0"><b>Next Due Date:</b> ${
              nextDueDate && Number.isFinite(nextDueDate.getTime())
                ? nextDueDate.toLocaleDateString()
                : "-"
            }</p>
            <p style="margin:10px 0 0; color:#94a3b8">Invoice attached (PDF)</p>
          </div>
          <p style="color:#cbd5e1; margin-top:16px">Regards,<br/>Techzuno Solutions</p>
        </div>
      </div>
      `,
      attachments: [
        {
          filename: path.basename(pdfPath),
          path: absolutePath,
        },
      ],
    };

    const info = await transporter.sendMail(mailOptions);

    try {
      await EmailLog.create({
        user_id: userId || null,
        direction: "outgoing",
        source: "platform",
        legacy_key: legacyKey,
        from_email: process.env.MAIL_USER || null,
        to_email: toEmail,
        subject: mailOptions.subject || null,
        body_html: mailOptions.html || null,
        body_text: null,
        status: "sent",
        provider_message_id: info?.messageId || null,
        meta_json: JSON.stringify({
          type: "billing_reminder",
          hasAttachment: true,
          attachment: path.basename(pdfPath),
        }),
      });
    } catch (e) {
      console.log("EMAIL LOG ERROR:", e?.message || e);
    }
  } catch (err) {
    try {
      await EmailLog.create({
        user_id: userId || null,
        direction: "outgoing",
        source: "platform",
        legacy_key: legacyKey,
        from_email: process.env.MAIL_USER || null,
        to_email: toEmail,
        subject,
        body_html: null,
        body_text: null,
        status: "failed",
        error_message: err?.message || String(err),
      });
    } catch (e) {
      console.log("EMAIL LOG ERROR:", e?.message || e);
    }
    console.log("MAIL ERROR:", err);
  }
};
