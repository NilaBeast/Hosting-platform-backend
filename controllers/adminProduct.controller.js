const ProductGroup = require("../models/ProductGroup");
const Product = require("../models/Product");
const Plan = require("../models/Plan");
const slugify = require("slugify");

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
  await ProductGroup.update(req.body, {
    where: { id: req.params.id },
  });
  res.json("Updated");
};

exports.deleteGroup = async (req, res) => {
  await ProductGroup.destroy({
    where: { id: req.params.id },
  });
  res.json("Deleted");
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
    const { name, product_group_id } = req.body;

    const updateData = {
      ...req.body,
    };

    if (name) {
      updateData.slug = slugify(name, { lower: true });
    }

    if (product_group_id) {
      const group = await ProductGroup.findByPk(product_group_id);
      if (!group) {
        return res.status(400).json("Invalid product group");
      }
      updateData.product_group_id = product_group_id;
    }

    await Product.update(updateData, {
      where: { id: req.params.id },
    });

    res.json("Updated");
  } catch (err) {
    res.status(500).json(err.message);
  }
};

exports.deleteProduct = async (req, res) => {
  await Product.destroy({
    where: { id: req.params.id },
  });
  res.json("Deleted");
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