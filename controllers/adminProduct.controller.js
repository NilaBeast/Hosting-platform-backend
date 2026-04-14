// controllers/adminProduct.controller.js

const ProductGroup = require("../models/ProductGroup");
const Product = require("../models/Product");
const Plan = require("../models/Plan");
const slugify = require("slugify");

/* ================= GROUP ================= */

exports.createGroup = async (req, res) => {
  const slug = slugify(req.body.name, { lower: true });

  const group = await ProductGroup.create({
    ...req.body,
    slug,
  });

  res.json(group);
};

exports.getGroups = async (req, res) => {
  const groups = await ProductGroup.findAll({
    include: [
      {
        model: Product,
      },
    ],
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
  const slug = slugify(req.body.name, { lower: true });

  const product = await Product.create({
    ...req.body,
    slug,
  });

  // 🔥 LINK PLAN HERE
  const plan = await Plan.findOne({
    where: { whm_package_name: req.body.whm_package_name },
  });

  if (plan) {
    await plan.update({
      product_id: product.id,
    });
  }

  res.json(product);
};

exports.getProducts = async (req, res) => {
  const products = await Product.findAll();
  res.json(products);
};

exports.updateProduct = async (req, res) => {
  const slug = slugify(req.body.name, { lower: true });

  await Product.update(
    {
      ...req.body,
      slug,
    },
    { where: { id: req.params.id } }
  );

  res.json("Updated");
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