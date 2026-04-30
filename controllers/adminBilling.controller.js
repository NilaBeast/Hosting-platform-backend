const Order = require("../models/Order");
const User = require("../models/User");
const Plan = require("../models/Plan");
const Invoice = require("../models/Invoice");
const UserAdminProfile = require("../models/UserAdminProfile");

exports.getTransactions = async (req, res) => {
  try {
    const safeJson = (value, fallback) => {
      try {
        if (!value) return fallback;
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    };

    const asNumber = (v) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const [users, orders, invoices, profiles] = await Promise.all([
      User.findAll({ attributes: ["id", "name", "email"] }),
      Order.findAll({
        include: [
          { model: User, attributes: ["id", "name", "email"] },
          { model: Plan, attributes: ["name"] },
        ],
        order: [["createdAt", "DESC"]],
      }),
      Invoice.findAll({
        include: [{ model: User, attributes: ["id", "name", "email"] }],
        order: [["createdAt", "DESC"]],
      }),
      UserAdminProfile.findAll({
        attributes: ["user_id", "profile_json"],
      }),
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));

    const out = [];

    for (const o of orders || []) {
      const plain = o?.get ? o.get({ plain: true }) : o;
      out.push({
        id: `order-${plain.id}`,
        source: "order",
        user: plain.User || null,
        planName: plain.Plan?.name || null,
        paymentId: plain.payment_id || null,
        amountIn: asNumber(plain.payment_amount || plain.total_price || 0),
        amountOut: 0,
        status: plain.payment_status || plain.status || "unknown",
        createdAt: plain.createdAt || null,
        description: `Order #${plain.id}${plain.domain ? ` - ${plain.domain}` : ""}`,
      });
    }

    for (const inv of invoices || []) {
      const plain = inv?.get ? inv.get({ plain: true }) : inv;
      out.push({
        id: `invoice-${plain.id}`,
        source: "invoice",
        user: plain.User || usersById.get(plain.user_id) || null,
        planName: null,
        paymentId: plain.invoice_number || null,
        amountIn: asNumber(plain.amount || 0),
        amountOut: 0,
        status: plain.status || "unknown",
        createdAt: plain.createdAt || null,
        description: `Invoice ${plain.invoice_number || `#${plain.id}`}`,
      });
    }

    for (const p of profiles || []) {
      const profile = safeJson(p.profile_json, {});
      const txns = Array.isArray(profile?.transactions) ? profile.transactions : [];
      if (txns.length === 0) continue;

      const user = usersById.get(p.user_id) || null;
      for (const t of txns) {
        const createdAt = t?.createdAt || null;
        out.push({
          id: `profile-${p.user_id}-${t?.source || "manual"}-${t?.legacyId ?? createdAt ?? Math.random()
            }`,
          source: t?.source || "manual",
          user,
          planName: null,
          paymentId: t?.transId || t?.invoiceId || null,
          amountIn: asNumber(t?.amountIn || 0),
          amountOut: asNumber(t?.amountOut || 0),
          status: "recorded",
          createdAt,
          description: t?.description || "Transaction",
          paymentMethod: t?.paymentMethod || null,
          fees: asNumber(t?.fees || 0),
        });
      }
    }

    const parseWhmcsInvoiceId = (value) => {
      if (value == null) return null;
      const str = String(value);
      const m = str.match(/WHMCS-(\d+)/i) || str.match(/\b(\d{3,})\b/);
      return m ? String(m[1]) : null;
    };

    const getTxnKey = (t) => {
      const src = String(t?.source || "").toLowerCase();
      if (src === "order") {
        const created = t?.createdAt ? new Date(t.createdAt).toISOString() : "";
        return `order:${t?.paymentId || ""}:${t?.id || ""}:${created}:${asNumber(t?.amountIn || 0)}`;
      }

      const invId =
        parseWhmcsInvoiceId(t?.paymentId) ||
        parseWhmcsInvoiceId(t?.invoiceId) ||
        parseWhmcsInvoiceId(t?.transId) ||
        parseWhmcsInvoiceId(t?.description);

      if (invId) return `invoice:${invId}:${asNumber(t?.amountIn || 0)}`;

      const created = t?.createdAt ? new Date(t.createdAt).toISOString() : "";
      return `misc:${src}:${created}:${t?.description || ""}:${asNumber(t?.amountIn || 0)}:${asNumber(
        t?.amountOut || 0
      )}:${asNumber(t?.fees || 0)}`;
    };

    const priority = (t) => {
      const src = String(t?.source || "").toLowerCase();
      if (src === "order") return 3;
      if (src === "invoice") return 2;
      return 1;
    };

    const deduped = [];
    const byKey = new Map();
    for (const t of out) {
      const key = getTxnKey(t);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, t);
        continue;
      }
      if (priority(t) > priority(existing)) byKey.set(key, t);
    }
    for (const v of byKey.values()) deduped.push(v);

    deduped.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });

    res.json(deduped);
  } catch (err) {
    res.status(500).json(err.message);
  }
};
