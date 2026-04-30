const ProductGroup = require("../models/ProductGroup");
const Product = require("../models/Product");
const Plan = require("../models/Plan");
const slugify = require("slugify");

async function killMysqlConnection(connectionId) {
  const id = Number(connectionId);
  if (!id) return false;
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    await conn.query(`KILL ${id}`);
    return true;
  } catch {
    return false;
  } finally {
    await conn.end();
  }
}

async function runWithDbTimeout(sequelize, timeoutMs, fn) {
  return sequelize.transaction(async (transaction) => {
    const [[row]] = await sequelize.query("SELECT CONNECTION_ID() AS id", {
      transaction,
    });
    const connId = row?.id;

    const timer = setTimeout(() => {
      killMysqlConnection(connId).catch(() => {});
    }, timeoutMs);

    try {
      return await fn(transaction);
    } finally {
      clearTimeout(timer);
    }
  });
}

async function cleanupStuckCatalogQueries() {
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    try {
      await conn.query("SET SESSION innodb_lock_wait_timeout = 10");
    } catch {}
    try {
      await conn.query("SET SESSION lock_wait_timeout = 10");
    } catch {}

    let myConnId = null;
    try {
      const [[row]] = await conn.query("SELECT CONNECTION_ID() AS id");
      myConnId = Number(row?.id || 0) || null;
    } catch {}

    const victims = new Set();

    try {
      const [trx] = await conn.query(
        "SELECT trx_mysql_thread_id AS thread_id, trx_started AS started_at, trx_query AS query_text FROM information_schema.innodb_trx"
      );
      for (const r of trx || []) {
        const q = String(r.query_text || "").toLowerCase();
        const startedAt = r.started_at ? new Date(r.started_at).getTime() : 0;
        const ageSec = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
        if (ageSec < 30) continue;
        if (
          q.includes("products") ||
          q.includes("productgroups") ||
          q.includes("plans") ||
          q.includes("alter table")
        ) {
          const threadId = Number(r.thread_id || 0) || null;
          if (!threadId) continue;
          if (myConnId && threadId === myConnId) continue;
          victims.add(threadId);
        }
      }
    } catch {}

    try {
      const [rows] = await conn.query("SHOW PROCESSLIST");
      for (const r of rows || []) {
        const state = String(r.State || "").toLowerCase();
        const info = String(r.Info || "").toLowerCase();
        const id = Number(r.Id || 0) || null;
        if (!id) continue;
        if (myConnId && id === myConnId) continue;

        const matchesCatalog =
          info.includes("products") || info.includes("productgroups") || info.includes("plans");
        if (!matchesCatalog) continue;

        const looksStuck =
          state.includes("opening tables") ||
          state.includes("metadata lock") ||
          state.includes("waiting for table metadata lock") ||
          state.includes("waiting for table flush") ||
          state.includes("table lock");

        const timeSec = Number(r.Time || 0) || 0;
        if (!looksStuck) continue;
        if (timeSec < 5) continue;
        victims.add(id);
      }
    } catch {}

    for (const id of victims) {
      try {
        await conn.query(`KILL ${Number(id)}`);
      } catch {}
    }
  } finally {
    await conn.end();
  }
}

/* ================= GROUP ================= */

exports.createGroup = async (req, res) => {
  try {
    const slug = slugify(req.body.name, { lower: true });

    const group = await ProductGroup.create({
      ...req.body,
      slug,
    });

    res.json(group);
  } catch (err) {
    res.status(500).json(err.message);
  }
};

exports.getGroups = async (req, res) => {
  const groups = await ProductGroup.findAll({
    include: [{ model: Product }],
  });

  res.json(groups);
};

exports.updateGroup = async (req, res) => {
  try {
    await cleanupStuckCatalogQueries();
    await runWithDbTimeout(Product.sequelize, 15000, async (transaction) => {
      await ProductGroup.update(req.body, {
        where: { id: req.params.id },
        transaction,
      });
    });
    res.json("Updated");
  } catch (err) {
    res.status(500).json(err.message);
  }
};

exports.deleteGroup = async (req, res) => {
  try {
    await cleanupStuckCatalogQueries();
    const groupId = Number(req.params.id);
    if (!groupId) return res.status(400).json("Invalid group id");

    const group = await ProductGroup.findByPk(groupId);
    if (!group) return res.status(404).json("Group not found");

    await runWithDbTimeout(Product.sequelize, 15000, async (transaction) => {
      const products = await Product.findAll({
        where: { product_group_id: groupId },
        transaction,
      });

      const productIds = products.map((p) => p.id);
      if (productIds.length) {
        await Plan.update(
          { product_id: null },
          { where: { product_id: productIds }, transaction }
        );

        await Product.destroy({
          where: { id: productIds },
          transaction,
        });
      }

      await ProductGroup.destroy({
        where: { id: groupId },
        transaction,
      });
    });

    res.json("Deleted");
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("Lock wait timeout") || msg.includes("server has gone away")) {
      return res.status(503).json("Database is busy/stuck. Restart MySQL service, then try again.");
    }
    res.status(500).json(msg);
  }
};

/* ================= PRODUCT ================= */

exports.createProduct = async (req, res) => {
  try {
    const { name, product_group_id, whm_package_name } = req.body;

    /* 🔥 VALIDATION */
    if (!product_group_id) {
      return res.status(400).json("Product group is required");
    }

    const group = await ProductGroup.findByPk(product_group_id);
    if (!group) {
      return res.status(400).json("Invalid product group");
    }

    const slug = slugify(name, { lower: true });

    const product = await Product.create({
      ...req.body,
      product_group_id, // ✅ FORCE SAVE
      slug,
    });

    /* 🔥 LINK PLAN */
    if (whm_package_name) {
      const plan = await Plan.findOne({
        where: { whm_package_name },
      });

      if (plan) {
        await plan.update({
          product_id: product.id,
        });
      }
    }

    res.json(product);
  } catch (err) {
    console.log(err);
    res.status(500).json(err.message);
  }
};

exports.getProducts = async (req, res) => {
  const products = await Product.findAll({
    include: [
      {
        model: ProductGroup,
        attributes: ["id", "name"],
      },
    ],
  });

  res.json(products);
};

exports.updateProduct = async (req, res) => {
  try {
    await cleanupStuckCatalogQueries();
    const { name, product_group_id } = req.body || {};

    const allowedFields = [
      "name",
      "description",
      "short_description",
      "whm_package_name",
      "price",
      "pricing_json",
      "upgrades",
      "free_domain_type",
      "free_domain_tlds",
      "product_group_id",
      "is_hidden",
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (req.body?.[key] !== undefined) updateData[key] = req.body[key];
    }

    if (updateData.pricing_json !== undefined && typeof updateData.pricing_json === "string") {
      try {
        updateData.pricing_json = JSON.parse(updateData.pricing_json);
      } catch {}
    }

    if (name) updateData.slug = slugify(name, { lower: true });

    if (product_group_id !== undefined) {
      const group = await ProductGroup.findByPk(product_group_id);
      if (!group) return res.status(400).json("Invalid product group");
      updateData.product_group_id = product_group_id;
    }

    const count = await runWithDbTimeout(Product.sequelize, 15000, async (transaction) => {
      const [c] = await Product.update(updateData, {
        where: { id: req.params.id },
        transaction,
      });
      return c;
    });

    res.json({ message: "Updated", updated: count });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("Lock wait timeout") || msg.includes("server has gone away")) {
      return res.status(503).json("Database is busy/stuck. Restart MySQL service, then try again.");
    }
    res.status(500).json(msg);
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    await cleanupStuckCatalogQueries();
    const productId = Number(req.params.id);
    if (!productId) return res.status(400).json("Invalid product id");

    const product = await Product.findByPk(productId);
    if (!product) return res.status(404).json("Product not found");

    await runWithDbTimeout(Product.sequelize, 15000, async (transaction) => {
      await Plan.update(
        { product_id: null },
        { where: { product_id: productId }, transaction }
      );

      await Product.destroy({
        where: { id: productId },
        transaction,
      });
    });

    res.json("Deleted");
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("Lock wait timeout") || msg.includes("server has gone away")) {
      return res.status(503).json("Database is busy/stuck. Restart MySQL service, then try again.");
    }
    res.status(500).json(msg);
  }
};

/* ================= WHM PACKAGES ================= */

exports.getWHMPackages = async (req, res) => {
  const plans = await Plan.findAll({
    include: [
      {
        model: Product,
        attributes: ["name"],
      },
    ],
  });

  res.json(plans);
};

/* ================= SLUG BASED PRODUCT ================= */

exports.getProductBySlug = async (req, res) => {
  try {
    const { groupSlug, productSlug } = req.params;

    const product = await Product.findOne({
      where: { slug: productSlug },
      include: [
        {
          model: ProductGroup,
          where: { slug: groupSlug },
          attributes: ["id", "name", "slug"],
        },
        {
          model: Plan,
        },
      ],
    });

    if (!product) {
      return res.status(404).json("Product not found");
    }

    const data = {
      id: product.id,
      name: product.name,
      slug: product.slug,

      group_name: product.ProductGroup?.name,
      group_slug: product.ProductGroup?.slug,

      plan: product.Plan || null,
    };

    res.json(data);
  } catch (err) {
    console.log(err);
    res.status(500).json("Failed to load product");
  }
};

/* ===============================
   GET PRODUCTS BY GROUP
================================ */
exports.getProductsByGroup = async (req, res) => {
  const { groupId } = req.params;

  const products = await Product.findAll({
    where: { product_group_id: groupId },
  });

  res.json(products);
};

/* ===============================
   GET PLANS BY PRODUCT
================================ */
exports.getPlansByProduct = async (req, res) => {
  const { productId } = req.params;

  const plans = await Plan.findAll({
    where: { product_id: productId },
  });

  res.json(plans);
};
