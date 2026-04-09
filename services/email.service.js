const nodemailer = require("nodemailer");

exports.sendMail = async (to, subject, text) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.host.com",
    port: 587,
    auth: {
      user: "email",
      pass: "password",
    },
  });

  await transporter.sendMail({
    from: "manika.basak1977@gmail.com",
    to,
    subject,
    text,
  });
};