require("./cron/packageSync.cron");
require("./cron/domainPricing.cron"); // start cron
const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { createProxyMiddleware } = require("http-proxy-middleware");
const errorMiddleware = require("./middlewares/error.middleware");

/* ===============================
   CORS
================================ */
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());

/* ===============================
   API ROUTES
================================ */
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/user", require("./routes/user.routes"));
app.use("/api/hosting", require("./routes/hosting.routes"));
app.use("/api/domain", require("./routes/domain.routes"));
app.use("/api/deploy", require("./routes/deploy.routes"));
// app.use("/api/github", require("./routes/github.routes"));
app.use("/api/plans", require("./routes/plan.routes"));
app.use("/api/profile", require("./routes/profile.routes"));
app.use("/api/payment", require("./routes/payment.routes"));
app.use("/invoices", express.static(path.join(__dirname, "../invoices")));
app.use("/api/invoices", require("./routes/invoice.routes"));
app.use("/api/domain-search", require("./routes/domainSearch.routes"));
/* ===============================
   ADMIN ROUTES (IMPORTANT)
================================ */
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/orders", require("./routes/order.routes"));
app.use("/api/admin/billing", require("./routes/adminBilling.routes"));
/* ===============================
   STATIC SITES
================================ */
const sitesDir = path.join(__dirname, "../sites");

app.use("/sites/:site", (req, res, next) => {
  const siteFolder = req.params.site;
  const sitePath = path.join(sitesDir, siteFolder);
  express.static(sitePath)(req, res, next);
});

/* ===============================
   NODE APP REVERSE PROXY
================================ */
const appsDir = path.join(__dirname, "../apps");

if (fs.existsSync(appsDir)) {
  const apps = fs.readdirSync(appsDir);

  let port = 4000;

  apps.forEach((appName) => {
    const target = `http://localhost:${port}`;

    app.use(
      `/sites/${appName}`,
      createProxyMiddleware({
        target,
        changeOrigin: true,
        pathRewrite: {
          [`^/sites/${appName}`]: "",
        },
      })
    );

    console.log("Proxying Node app:", appName, "->", target);
    port++;
  });
}

/* ===============================
   GLOBAL ASSET HANDLER
================================ */
app.use((req, res, next) => {
  const assetPath = req.path;

  if (
    assetPath.startsWith("/assets") ||
    assetPath.startsWith("/images") ||
    assetPath.startsWith("/static") ||
    assetPath.startsWith("/build") ||
    assetPath.startsWith("/dist")
  ) {
    if (!fs.existsSync(sitesDir)) return next();

    const sites = fs.readdirSync(sitesDir);

    for (const site of sites) {
      const filePath = path.join(sitesDir, site, assetPath);

      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }
  }

  next();
});

/* ===============================
   SPA FALLBACK
================================ */
app.get(/^\/sites\/([^\/]+)\/.*$/, (req, res) => {
  const siteFolder = req.params[0];
  const indexPath = path.join(sitesDir, siteFolder, "index.html");

  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Site not found");
  }
});

/* ===============================
   404 API HANDLER
================================ */
app.use("/api", (req, res) => {
  res.status(404).json("API Route Not Found");
});

/* ===============================
   ERROR HANDLER
================================ */
app.use(errorMiddleware);

module.exports = app;