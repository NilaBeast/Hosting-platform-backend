const Invoice = require("../models/Invoice");
const InvoiceItem = require("../models/InvoiceItem");
const User = require("../models/User");
const { generateInvoicePDF } = require("../services/invoice.service");
const { sendInvoiceMail } = require("../services/invoiceMail.service");

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

    const invoiceNumber = "INV-" + Date.now();

    const invoice = await Invoice.create({
      user_id,
      invoice_number: invoiceNumber,
      customer_name: user.name,
      email: user.email,
      amount,
      status: "paid",
    });

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

    const pdfPath = await generateInvoicePDF(invoice, invoiceItems);

    invoice.pdf_path = pdfPath;
    await invoice.save();

    await sendInvoiceMail(invoice.email, pdfPath);

    res.json({ message: "Invoice created", invoice });
  } catch (err) {
    console.log(err);
    res.status(500).json("Invoice creation failed");
  }
};

/* DOWNLOAD PDF */
exports.downloadInvoice = async (req, res) => {
  const invoice = await Invoice.findByPk(req.params.id);

  res.download(invoice.pdf_path);
};

/* RESEND INVOICE MAIL */
exports.sendInvoiceMailAgain = async (req, res) => {
  const invoice = await Invoice.findByPk(req.params.id);

  await sendInvoiceMail(invoice.email, invoice.pdf_path);

  res.json({ message: "Invoice mail sent again" });
};