const sequelize = require("../config/db");

const User = require("./User");
const Plan = require("./Plan");
const HostingAccount = require("./HostingAccount");
const Domain = require("./Domain");
const Deployment = require("./Deployment");
const Order = require("./Order");
const Invoice = require("./Invoice");
const InvoiceItem = require("./InvoiceItem");

/*==================INVOICE==================*/
Invoice.hasMany(InvoiceItem, { foreignKey: "invoice_id" });
InvoiceItem.belongsTo(Invoice, { foreignKey: "invoice_id" });

User.hasMany(Invoice, { foreignKey: "user_id" });
Invoice.belongsTo(User, { foreignKey: "user_id" });

Order.hasOne(Invoice, { foreignKey: "order_id" });
Invoice.belongsTo(Order, { foreignKey: "order_id" });
/* ===============================
   ASSOCIATIONS
================================ */
/* User -> Orders */
User.hasMany(Order, { foreignKey: "user_id" });
Order.belongsTo(User, { foreignKey: "user_id" });

/* Plan -> Orders */
Plan.hasMany(Order, { foreignKey: "plan_id" });
Order.belongsTo(Plan, { foreignKey: "plan_id" });
// User -> Hosting Accounts
User.hasMany(HostingAccount, { foreignKey: "user_id" });
HostingAccount.belongsTo(User, { foreignKey: "user_id" });

// User -> Domains
User.hasMany(Domain, { foreignKey: "user_id" });
Domain.belongsTo(User, { foreignKey: "user_id" });

// User -> Deployments
User.hasMany(Deployment, { foreignKey: "user_id" });
Deployment.belongsTo(User, { foreignKey: "user_id" });

module.exports = {
  sequelize,
  User,
  Plan,
  HostingAccount,
  Domain,
  Deployment,
  Order,
};