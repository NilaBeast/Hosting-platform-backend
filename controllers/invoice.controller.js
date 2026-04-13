const Invoice = require("../models/Invoice");
const InvoiceItem = require("../models/InvoiceItem");
const User = require("../models/User");
const { generateInvoicePDF } = require("../services/invoice.service");
const { sendInvoiceMail } = require("../services/invoiceMail.service");
const path = require("path");
const fs = require("fs");

/* GET ALL INVOICES */
exports.getInvoices = async (req, res) => {
  const invoices = await Invoice.findAll({
    include: [{ model: User }],
    order: [["createdAt", "DESC"]],
  });

  res.json(invoices);
};

/* GET SINGLE INVOICE */
exports.getInvoiceById = async (req, res) => {
  const invoice = await Invoice.findByPk(req.params.id, {
    include: [InvoiceItem, User],
  });

  res.json(invoice);
};

/* CREATE CUSTOM INVOICE (ADMIN) */
exports.createInvoice = async (req, res) => {
  try {
    const { user_id, items, amount } = req.body;

    const user = await User.findByPk(user_id);

    if (!user) {
      return res.status(404).json("User not found");
    }

    const invoiceNumber = "INV-" + Date.now();

    const invoice = await Invoice.create({
      user_id,
      invoice_number: invoiceNumber,
      customer_name: user.name,
      email: user.email,
      amount,
      status: "paid",
    });

    console.log("STEP 1: Invoice created:", invoice.id);

    // create items
    for (const item of items) {
      await InvoiceItem.create({
        invoice_id: invoice.id,
        description: item.description,
        qty: item.qty,
        rate: item.rate,
        amount: item.amount,
      });
    }

    const invoiceItems = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id },
    });

    console.log("STEP 2: Items ready");

    // 🔥 GENERATE PDF
    const pdfPath = await generateInvoicePDF(invoice, invoiceItems);

    console.log("STEP 3: PDF PATH =", pdfPath);

    if (!pdfPath) {
      throw new Error("PDF path is undefined");
    }

    // 🔥 FORCE UPDATE (IMPORTANT CHANGE)
    await Invoice.update(
      { pdf_path: pdfPath },
      { where: { id: invoice.id } }
    );

    console.log("STEP 4: DB UPDATED");

    // 🔥 FETCH AGAIN (IMPORTANT)
    const updatedInvoice = await Invoice.findByPk(invoice.id);

    console.log("STEP 5: SAVED VALUE =", updatedInvoice.pdf_path);

    // SEND MAIL
    await sendInvoiceMail(updatedInvoice.email, pdfPath);

    res.json({
      message: "Invoice created",
      invoice: updatedInvoice,
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json(err.message);
  }
};

/* DOWNLOAD PDF */
exports.downloadInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);

    if (!invoice || !invoice.pdf_path) {
      return res.status(404).json("Invoice file not found");
    }

    const fullPath = path.join(__dirname, "../../", invoice.pdf_path);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json("File missing on server");
    }

    res.download(fullPath);
  } catch (err) {
    console.error(err);
    res.status(500).json("Download failed");
  }
};

/* RESEND INVOICE MAIL */
exports.sendInvoiceMailAgain = async (req, res) => {
  const invoice = await Invoice.findByPk(req.params.id);

  await sendInvoiceMail(invoice.email, invoice.pdf_path);

  res.json({ message: "Invoice mail sent again" });
};