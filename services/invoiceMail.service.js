const nodemailer = require("nodemailer");
const path = require("path");

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
exports.sendInvoiceMail = async (toEmail, pdfPath) => {
  try {
    // Convert relative path to absolute path
    const absolutePath = path.join(
      __dirname,
      "../../",
      pdfPath
    );

    await transporter.sendMail({
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
    });

    console.log("Invoice mail sent to:", toEmail);
  } catch (err) {
    console.log("MAIL ERROR:", err);
  }
};