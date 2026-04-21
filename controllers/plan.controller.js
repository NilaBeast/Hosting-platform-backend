const Plan = require("../models/Plan");
const { getWHMPackages } = require("../services/whmPackage.service");

const Product = require("../models/Product");
const ProductGroup = require("../models/ProductGroup");

exports.getPlans = async (req, res) => {
  const plans = await Plan.findAll({
    include: [
      {
        model: Product,
        include: [
          {
            model: ProductGroup,
            attributes: ["id", "name"],
          },
        ],
        attributes: ["id", "name"],
      },
    ],
  });

  const formatted = plans.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,

    product_name: p.Product?.name,
    group_name: p.Product?.ProductGroup?.name,

    display_name: `${p.Product?.ProductGroup?.name || "No Group"} → ${
      p.Product?.name || "No Product"
    } → ${p.name}`,
  }));

  res.json(formatted);
};
/* SYNC WHM PACKAGES TO DB */
exports.syncWHMPackages = async (req, res) => {
  try {
    const packages = await getWHMPackages();

    for (const pkg of packages) {
      await Plan.upsert({
        name: pkg.name,
        disk: pkg.quota,
        bandwidth: pkg.bandwidth,
        price: pkg.name === "starter" ? 99 : 199,
        whm_package_name: pkg.name,
      });
    }

    res.json({ message: "Packages synced from WHM" });
  } catch (err) {
    console.log(err);
    res.status(500).json("WHM Sync Failed");
  }
};