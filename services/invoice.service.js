const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

exports.generateInvoicePDF = (invoice, items) => {
  return new Promise((resolve, reject) => {
    try {
      const invoicesDir = path.join(__dirname, "../../invoices");

      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
      }

      const fileName = `invoice_${invoice.invoice_number}.pdf`;
      const filePath = path.join(invoicesDir, fileName);

      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      /* ================= HEADER LEFT ================= */
      doc
        .fontSize(20)
        .text("SERVICE INVOICE", 50, 50);

      /* ================= HEADER RIGHT (LOGO + COMPANY DETAILS) ================= */
      const logoPath = path.join(__dirname, "../../assets/logo.png");

      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 400, 40, { width: 120 });
      }

      doc
        .fontSize(10)
        .text("TECHZUNO SOLUTIONS (OPC) PRIVATE LIMITED", 300, 120, {
          align: "right",
        })
        .text("Kolkata West Bengal 700039, India", {
          align: "right",
        })
        .text("+916290340824", {
          align: "right",
        })
        .text("info@techzuno.com", {
          align: "right",
        })
        .text("www.techzuno.com", {
          align: "right",
        });

      /* ================= INVOICE INFO ================= */
      doc.moveDown();
      doc.fontSize(10);

      doc.text(`Invoice No: ${invoice.invoice_number}`, 50, 180);
      doc.text(`Invoice Date: ${new Date().toLocaleDateString()}`, 50, 200);
      doc.text(`Terms: Custom`, 50, 220);
      doc.text(`Due Date: ${new Date().toLocaleDateString()}`, 50, 240);

      /* ================= BILL TO ================= */
      doc.text("Bill To:", 350, 180);
      doc.text(invoice.customer_name, 350, 200);
      doc.text(invoice.email, 350, 220);

      /* ================= TABLE HEADER ================= */
      let tableTop = 280;

      doc.rect(50, tableTop, 500, 20).fill("#444");

      doc
        .fillColor("#fff")
        .fontSize(10)
        .text("Item & Description", 55, tableTop + 5)
        .text("Qty", 300, tableTop + 5)
        .text("Rate", 350, tableTop + 5)
        .text("Amount", 450, tableTop + 5);

      doc.fillColor("#000");

      /* ================= TABLE ROWS ================= */
      let y = tableTop + 30;
      let subtotal = 0;

      items.forEach((item) => {
        doc.text(item.description, 55, y);
        doc.text(item.qty.toString(), 300, y);
        doc.text(item.rate.toString(), 350, y);
        doc.text(item.amount.toString(), 450, y);

        subtotal += item.amount;
        y += 20;
      });

      /* ================= TOTALS ================= */
      doc.text("Subtotal:", 350, y + 20);
      doc.text(`₹${subtotal}`, 450, y + 20);

      doc.fontSize(12).text("Total:", 350, y + 40);
      doc.text(`₹${invoice.amount}`, 450, y + 40);

      /* ================= NOTES ================= */
      doc.fontSize(10).text("Notes:", 50, y + 80);
      doc.text("Thanks for your business.", 50, y + 95);

      /* ================= QR CODE ================= */
      const qrPath = path.join(__dirname, "../../assets/qrcode.png");
      if (fs.existsSync(qrPath)) {
        doc.image(qrPath, 50, y + 140, { width: 90 });
      }

      /* ================= SIGNATURE ================= */
      const signPath = path.join(__dirname, "../../assets/sign.png");
      if (fs.existsSync(signPath)) {
        doc.image(signPath, 400, y + 140, { width: 120 });
      }

      doc.text("Authorized Signature", 400, y + 200);

      doc.end();

      stream.on("finish", () => {
        resolve(`invoices/${fileName}`);
      });

      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
};