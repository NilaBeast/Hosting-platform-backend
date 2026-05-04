const fs = require("fs");
const path = require("path");
const readline = require("readline");

const { sequelize } = require("./models");
const User = require("./models/User");
const Domain = require("./models/Domain");
const HostingAccount = require("./models/HostingAccount");
const Invoice = require("./models/Invoice");
const InvoiceItem = require("./models/InvoiceItem");
const Ticket = require("./models/Ticket");
const TicketReply = require("./models/TicketReply");
const UserAdminProfile = require("./models/UserAdminProfile");
const EmailLog = require("./models/EmailLog");
const Plan = require("./models/Plan");
const Order = require("./models/Order");

const DEFAULT_SQL_PATH =
  "c:\\Users\\Nilajeet Basak\\Desktop\\Techzuno Office\\cloudsensy_bill.sql";

const TARGET_TABLES = new Set([
  "tblclients",
  "tblcontacts",
  "tblhosting",
  "tbldomains",
  "tblaccounts",
  "tblemails",
  "tblbillableitems",
  "tbltickets",
  "tblticketreplies",
  "tblinvoices",
  "tblinvoiceitems",
  "tblproducts",
  "tblusers",
]);

function toLowerSafe(value) {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function coerceString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return String(value);
}

function normalizeEmail(email) {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  if (!e) return null;
  if (!e.includes("@")) return null;
  return e;
}

function normalizeBcryptHash(hash) {
  if (typeof hash !== "string") return null;
  const trimmed = hash.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("$2y$")) return `$2b$${trimmed.slice(4)}`;
  return trimmed;
}

function parseDate(value) {
  if (typeof value !== "string") return null;
  if (!value || value === "0000-00-00" || value === "0000-00-00 00:00:00")
    return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compareDatesDesc(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (da && db) return db.getTime() - da.getTime();
  if (da && !db) return -1;
  if (!da && db) return 1;
  return 0;
}

function parseRawToken(token) {
  if (!token) return null;
  if (/^null$/i.test(token)) return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    const asNumber = Number(token);
    if (!Number.isFinite(asNumber)) return token;
    if (Number.isInteger(asNumber) && !Number.isSafeInteger(asNumber))
      return token;
    return asNumber;
  }
  return token;
}

function parseInsertStatement(sql) {
  const m = sql.match(/^\s*INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?/i);
  if (!m) return null;
  const table = m[1];
  if (!TARGET_TABLES.has(table)) return null;

  let i = m[0].length;
  while (i < sql.length && /\s/.test(sql[i])) i++;

  let columns = null;
  if (sql[i] === "(") {
    const start = i;
    let depth = 0;
    for (; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === "(") depth++;
      if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const end = i;
    const colsRaw = sql.slice(start + 1, end);
    columns = colsRaw
      .split(",")
      .map((c) => c.trim().replace(/^`/, "").replace(/`$/, ""))
      .filter(Boolean);
    i++;
  }

  const valuesIndex = sql.slice(i).search(/\bVALUES\b/i);
  if (valuesIndex === -1) return null;
  const valuesSql = sql
    .slice(i + valuesIndex)
    .replace(/^\s*VALUES\s*/i, "")
    .trim();

  const rows = [];
  let p = 0;
  while (p < valuesSql.length) {
    while (
      p < valuesSql.length &&
      (valuesSql[p] === "," || /\s/.test(valuesSql[p]))
    )
      p++;
    if (p >= valuesSql.length) break;
    if (valuesSql[p] === ";") break;
    if (valuesSql[p] !== "(") {
      p++;
      continue;
    }

    p++;
    const values = [];
    let inString = false;
    let stringBuf = "";
    let rawBuf = "";
    let currentType = "raw";

    const pushCurrent = () => {
      if (currentType === "string") values.push(stringBuf);
      else values.push(parseRawToken(rawBuf.trim()));
      inString = false;
      stringBuf = "";
      rawBuf = "";
      currentType = "raw";
    };

    while (p < valuesSql.length) {
      const ch = valuesSql[p];
      if (inString) {
        if (ch === "'") {
          inString = false;
          currentType = "string";
          p++;
          continue;
        }
        if (ch === "\\") {
          const next = valuesSql[p + 1];
          if (next === undefined) {
            p++;
            continue;
          }
          const map = {
            0: "\0",
            b: "\b",
            n: "\n",
            r: "\r",
            t: "\t",
            Z: "\x1a",
            "'": "'",
            '"': '"',
            "\\": "\\",
          };
          stringBuf += map[next] ?? next;
          p += 2;
          continue;
        }
        stringBuf += ch;
        p++;
        continue;
      }

      if (ch === "'") {
        inString = true;
        p++;
        continue;
      }
      if (ch === ",") {
        pushCurrent();
        p++;
        continue;
      }
      if (ch === ")") {
        pushCurrent();
        p++;
        break;
      }
      rawBuf += ch;
      p++;
    }

    rows.push(values);
    while (p < valuesSql.length && /\s/.test(valuesSql[p])) p++;
    if (valuesSql[p] === ";") break;
  }

  return { table, columns, rows };
}

function pickClientSafeFields(clientRow) {
  return {
    id: clientRow.id ?? null,
    uuid: clientRow.uuid ?? null,
    firstname: clientRow.firstname ?? null,
    lastname: clientRow.lastname ?? null,
    companyname: clientRow.companyname ?? null,
    email: clientRow.email ?? null,
    phonenumber: clientRow.phonenumber ?? null,
    address1: clientRow.address1 ?? null,
    address2: clientRow.address2 ?? null,
    city: clientRow.city ?? null,
    state: clientRow.state ?? null,
    postcode: clientRow.postcode ?? null,
    country: clientRow.country ?? null,
    status: clientRow.status ?? null,
    datecreated: clientRow.datecreated ?? null,
    defaultgateway: clientRow.defaultgateway ?? null,
  };
}

function pickHostingSafeFields(hostingRow, productName) {
  return {
    id: hostingRow.id ?? null,
    userid: hostingRow.userid ?? null,
    packageid: hostingRow.packageid ?? null,
    productName: productName ?? null,
    regdate: hostingRow.regdate ?? null,
    domain: hostingRow.domain ?? null,
    paymentmethod: hostingRow.paymentmethod ?? null,
    firstpaymentamount: hostingRow.firstpaymentamount ?? null,
    amount: hostingRow.amount ?? null,
    billingcycle: hostingRow.billingcycle ?? null,
    nextduedate: hostingRow.nextduedate ?? null,
    nextinvoicedate: hostingRow.nextinvoicedate ?? null,
    domainstatus: hostingRow.domainstatus ?? null,
    username: hostingRow.username ?? null,
  };
}

function pickDomainSafeFields(domainRow) {
  return {
    id: domainRow.id ?? null,
    userid: domainRow.userid ?? null,
    domain: domainRow.domain ?? null,
    status: domainRow.status ?? null,
    type: domainRow.type ?? null,
    registrationdate: domainRow.registrationdate ?? null,
    expirydate: domainRow.expirydate ?? null,
    nextduedate: domainRow.nextduedate ?? null,
    recurringamount: domainRow.recurringamount ?? null,
    registrationperiod: domainRow.registrationperiod ?? null,
    paymentmethod: domainRow.paymentmethod ?? null,
  };
}

function pickInvoiceSafeFields(invoiceRow) {
  return {
    id: invoiceRow.id ?? null,
    userid: invoiceRow.userid ?? null,
    date: invoiceRow.date ?? null,
    duedate: invoiceRow.duedate ?? null,
    datepaid: invoiceRow.datepaid ?? null,
    subtotal: invoiceRow.subtotal ?? null,
    tax: invoiceRow.tax ?? null,
    tax2: invoiceRow.tax2 ?? null,
    total: invoiceRow.total ?? null,
    status: invoiceRow.status ?? null,
    paymentmethod: invoiceRow.paymentmethod ?? null,
  };
}

function pickInvoiceItemSafeFields(itemRow) {
  return {
    id: itemRow.id ?? null,
    invoiceid: itemRow.invoiceid ?? null,
    type: itemRow.type ?? null,
    relid: itemRow.relid ?? null,
    description: itemRow.description ?? null,
    amount: itemRow.amount ?? null,
    duedate: itemRow.duedate ?? null,
    paymentmethod: itemRow.paymentmethod ?? null,
  };
}

function pickAccountSafeFields(row) {
  return {
    legacyId: row.id ?? null,
    userid: row.userid ?? null,
    paymentMethod: row.gateway ?? null,
    createdAt: row.date ?? null,
    description: row.description ?? null,
    amountIn: row.amountin ?? null,
    fees: row.fees ?? null,
    amountOut: row.amountout ?? null,
    transId: row.transid ?? null,
    invoiceId: row.invoiceid ?? null,
  };
}

function pickEmailSafeFields(row) {
  return {
    legacyId: row.id ?? null,
    userid: row.userid ?? null,
    subject: row.subject ?? null,
    body: row.message ?? null,
    createdAt: row.date ?? null,
    to: row.to ?? null,
    cc: row.cc ?? null,
    bcc: row.bcc ?? null,
    attachments: row.attachments ?? null,
    source: "legacy",
  };
}

function pickContactSafeFields(row) {
  return {
    legacyId: row.id ?? null,
    firstName: row.firstname ?? null,
    lastName: row.lastname ?? null,
    companyName: row.companyname ?? null,
    email: row.email ?? null,
    phone: row.phonenumber ?? null,
    address1: row.address1 ?? null,
    address2: row.address2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    postcode: row.postcode ?? null,
    country: row.country ?? null,
  };
}

function pickBillableSafeFields(row) {
  return {
    legacyId: row.id ?? null,
    createdAt: row.duedate ?? null,
    description: row.description ?? null,
    amount: row.amount ?? null,
    hours: row.hours ?? null,
    dueDate: row.duedate ?? null,
    recur: row.recur ?? null,
    recurCycle: row.recurcycle ?? null,
    recurFor: row.recurfor ?? null,
    source: "legacy",
  };
}

function pickTicketSafeFields(row) {
  return {
    legacyId: row.id ?? null,
    ticket_id: row.tid ?? null,
    subject: row.title ?? null,
    department: row.did ?? null,
    priority: row.urgency ?? null,
    status: row.status ?? null,
    createdAt: row.date ?? null,
    updatedAt: row.updated_at ?? null,
    initialMessage: row.message ?? null,
    attachments: row.attachment ?? null,
    cc: row.cc ?? null,
    ipaddress: row.ipaddress ?? null,
  };
}

function pickTicketReplySafeFields(row) {
  return {
    legacyId: row.id ?? null,
    tid: row.tid ?? null,
    userid: row.userid ?? null,
    createdAt: row.date ?? null,
    message: row.message ?? null,
    admin: row.admin ?? null,
    attachment: row.attachment ?? null,
  };
}

function parseArgs(argv) {
  const args = {
    sqlPath: null,
    import: false,
    dryRun: false,
    outPath: null,
    sync: true,
    includePasswordHash: false,
    stats: false,
  };

  const rest = [...argv];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token) continue;

    if (token === "--import") args.import = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--out") args.outPath = rest[i + 1], i++;
    else if (token === "--no-sync") args.sync = false;
    else if (token === "--sync") args.sync = true;
    else if (token === "--stats") args.stats = true;
    else if (token === "--include-password-hash") args.includePasswordHash = true;
    else if (!token.startsWith("--") && !args.sqlPath) args.sqlPath = token;
  }

  args.sqlPath = args.sqlPath || DEFAULT_SQL_PATH;
  return args;
}

function statusToHostingStatus(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "active") return "active";
  if (v === "suspended") return "suspended";
  if (v === "terminated") return "terminated";
  if (v) return v;
  return "unknown";
}

function domainStatusToStatus(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "active") return "active";
  if (v === "pending") return "pending";
  if (v === "expired") return "expired";
  if (v === "cancelled") return "cancelled";
  if (v) return v;
  return "active";
}

async function extractFromSql(sqlPath) {
  const updateSqlStateAndHasTerminator = (() => {
    let inString = false;
    let escape = false;
    return (chunk) => {
      for (let idx = 0; idx < chunk.length; idx++) {
        const ch = chunk[idx];
        if (escape) {
          escape = false;
          continue;
        }
        if (inString) {
          if (ch === "\\") {
            escape = true;
            continue;
          }
          if (ch === "'") inString = false;
          continue;
        }
        if (ch === "'") {
          inString = true;
          continue;
        }
        if (ch === ";") return true;
      }
      return false;
    };
  })();

  const clientsById = new Map();
  const contactRows = [];
  const hostingRows = [];
  const domainRows = [];
  const accountRows = [];
  const emailRows = [];
  const billableRows = [];
  const ticketRows = [];
  const ticketReplyRows = [];
  const invoiceRows = [];
  const invoiceItemRows = [];
  const productsById = new Map();
  const usersByEmail = new Map();

  const stream = fs.createReadStream(sqlPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let capturing = false;
  let statement = "";
  let captureTable = null;
  let sectionTable = null;
  const completedTables = new Set();
  const noteSectionChange = (nextTable) => {
    if (sectionTable && TARGET_TABLES.has(sectionTable)) {
      completedTables.add(sectionTable);
    }
    sectionTable = nextTable;
  };

  for await (const line of rl) {
    const sectionMatch = line.match(
      /^\s*--\s+Dumping data for table\s+`([^`]+)`\s*$/i,
    );
    if (sectionMatch) {
      noteSectionChange(sectionMatch[1]);
    }

    if (!capturing) {
      const insertMatch = line.match(
        /^\s*INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?/i,
      );
      if (insertMatch) {
        const table = insertMatch[1];
        if (TARGET_TABLES.has(table)) {
          capturing = true;
          captureTable = table;
          statement = line + "\n";
          if (updateSqlStateAndHasTerminator(statement)) {
            capturing = false;
            captureTable = null;
            const parsed = parseInsertStatement(statement);
            if (parsed) {
              const { table: t, columns, rows } = parsed;
              const columnNames =
                columns ??
                (() => {
                  throw new Error(`No column list found for table ${t}.`);
                })();
              for (const tuple of rows) {
                const obj = {};
                for (let idx = 0; idx < columnNames.length; idx++) {
                  obj[columnNames[idx]] = tuple[idx];
                }
                if (t === "tblclients") clientsById.set(obj.id, obj);
                else if (t === "tblcontacts") contactRows.push(obj);
                else if (t === "tblhosting") hostingRows.push(obj);
                else if (t === "tbldomains") domainRows.push(obj);
                else if (t === "tblaccounts") accountRows.push(obj);
                else if (t === "tblemails") emailRows.push(obj);
                else if (t === "tblbillableitems") billableRows.push(obj);
                else if (t === "tbltickets") ticketRows.push(obj);
                else if (t === "tblticketreplies") ticketReplyRows.push(obj);
                else if (t === "tblinvoices") invoiceRows.push(obj);
                else if (t === "tblinvoiceitems") invoiceItemRows.push(obj);
                else if (t === "tblproducts") productsById.set(obj.id, obj);
                else if (t === "tblusers") {
                  const email = normalizeEmail(obj.email);
                  if (email) {
                    const prev = usersByEmail.get(email);
                    const prevUpdated = prev?.updated_at;
                    const currUpdated = obj?.updated_at;
                    const replace =
                      !prev ||
                      (!coerceString(prev.password) && coerceString(obj.password)) ||
                      compareDatesDesc(prevUpdated, currUpdated) > 0;
                    if (replace) usersByEmail.set(email, obj);
                  }
                }
              }
            }
            statement = "";
          }
        }
      }

      if (completedTables.size === TARGET_TABLES.size) {
        rl.close();
        stream.destroy();
        break;
      }
      continue;
    }

    statement += line + "\n";
    if (updateSqlStateAndHasTerminator(line + "\n")) {
      capturing = false;
      captureTable = null;

      const parsed = parseInsertStatement(statement);
      if (parsed) {
        const { table: t, columns, rows } = parsed;
        const columnNames =
          columns ??
          (() => {
            throw new Error(`No column list found for table ${t}.`);
          })();

        for (const tuple of rows) {
          const obj = {};
          for (let idx = 0; idx < columnNames.length; idx++) {
            obj[columnNames[idx]] = tuple[idx];
          }
          if (t === "tblclients") clientsById.set(obj.id, obj);
          else if (t === "tblcontacts") contactRows.push(obj);
          else if (t === "tblhosting") hostingRows.push(obj);
          else if (t === "tbldomains") domainRows.push(obj);
          else if (t === "tblaccounts") accountRows.push(obj);
          else if (t === "tblemails") emailRows.push(obj);
          else if (t === "tblbillableitems") billableRows.push(obj);
          else if (t === "tbltickets") ticketRows.push(obj);
          else if (t === "tblticketreplies") ticketReplyRows.push(obj);
          else if (t === "tblinvoices") invoiceRows.push(obj);
          else if (t === "tblinvoiceitems") invoiceItemRows.push(obj);
          else if (t === "tblproducts") productsById.set(obj.id, obj);
          else if (t === "tblusers") {
            const email = normalizeEmail(obj.email);
            if (email) {
              const prev = usersByEmail.get(email);
              const prevUpdated = prev?.updated_at;
              const currUpdated = obj?.updated_at;
              const replace =
                !prev ||
                (!coerceString(prev.password) && coerceString(obj.password)) ||
                compareDatesDesc(prevUpdated, currUpdated) > 0;
              if (replace) usersByEmail.set(email, obj);
            }
          }
        }
      }
      statement = "";
    }

    if (!capturing && completedTables.size === TARGET_TABLES.size) {
      rl.close();
      stream.destroy();
      break;
    }
  }

  if (sectionTable && TARGET_TABLES.has(sectionTable)) {
    completedTables.add(sectionTable);
  }

  if (captureTable) {
    process.stderr.write(
      `Warning: ended while still capturing an INSERT for ${captureTable}\n`,
    );
  }

  const activeHostingByUser = new Map();
  for (const h of hostingRows) {
    if (toLowerSafe(h.domainstatus) !== "active") continue;
    const prev = activeHostingByUser.get(h.userid);
    if (!prev) {
      activeHostingByUser.set(h.userid, h);
      continue;
    }
    const byNextDue = compareDatesDesc(prev.nextduedate, h.nextduedate);
    if (byNextDue > 0) activeHostingByUser.set(h.userid, h);
  }

  const domainsByUser = new Map();
  for (const d of domainRows) {
    if (!domainsByUser.has(d.userid)) domainsByUser.set(d.userid, []);
    domainsByUser.get(d.userid).push(d);
  }

  const contactsByUser = new Map();
  for (const c of contactRows) {
    if (!contactsByUser.has(c.userid)) contactsByUser.set(c.userid, []);
    contactsByUser.get(c.userid).push(c);
  }

  const accountsByUser = new Map();
  for (const a of accountRows) {
    if (!accountsByUser.has(a.userid)) accountsByUser.set(a.userid, []);
    accountsByUser.get(a.userid).push(a);
  }

  const emailsByUser = new Map();
  for (const e of emailRows) {
    if (!emailsByUser.has(e.userid)) emailsByUser.set(e.userid, []);
    emailsByUser.get(e.userid).push(e);
  }

  const billableByUser = new Map();
  for (const b of billableRows) {
    if (!billableByUser.has(b.userid)) billableByUser.set(b.userid, []);
    billableByUser.get(b.userid).push(b);
  }

  const ticketsByUser = new Map();
  for (const t of ticketRows) {
    if (!ticketsByUser.has(t.userid)) ticketsByUser.set(t.userid, []);
    ticketsByUser.get(t.userid).push(t);
  }

  const ticketRepliesByTicketId = new Map();
  for (const r of ticketReplyRows) {
    if (!ticketRepliesByTicketId.has(r.tid)) ticketRepliesByTicketId.set(r.tid, []);
    ticketRepliesByTicketId.get(r.tid).push(r);
  }

  const invoicesByUser = new Map();
  for (const inv of invoiceRows) {
    if (!invoicesByUser.has(inv.userid)) invoicesByUser.set(inv.userid, []);
    invoicesByUser.get(inv.userid).push(inv);
  }

  const invoiceItemsByInvoiceId = new Map();
  for (const item of invoiceItemRows) {
    if (!invoiceItemsByInvoiceId.has(item.invoiceid))
      invoiceItemsByInvoiceId.set(item.invoiceid, []);
    invoiceItemsByInvoiceId.get(item.invoiceid).push(item);
  }

  const output = [];
  for (const client of clientsById.values()) {
    const activeHosting = activeHostingByUser.get(client.id) ?? null;
    const productName =
      activeHosting && productsById.get(activeHosting.packageid)
        ? productsById.get(activeHosting.packageid).name
        : null;

    const clientInvoices = invoicesByUser.get(client.id) ?? [];
    const lastInvoice = [...clientInvoices].sort((a, b) => {
      const byDate = compareDatesDesc(a.date, b.date);
      if (byDate !== 0) return byDate;
      return (b.id ?? 0) - (a.id ?? 0);
    })[0];

    const unpaidInvoices = clientInvoices
      .filter((i) => toLowerSafe(i.status) === "unpaid")
      .sort((a, b) => {
        const byDue = compareDatesDesc(a.duedate, b.duedate);
        if (byDue !== 0) return byDue;
        return (b.id ?? 0) - (a.id ?? 0);
      })
      .map(pickInvoiceSafeFields);

    const unpaidTotal = unpaidInvoices.reduce(
      (sum, inv) => sum + (typeof inv.total === "number" ? inv.total : 0),
      0,
    );

    const lastInvoiceSafe = lastInvoice ? pickInvoiceSafeFields(lastInvoice) : null;
    const lastInvoiceItemsSafe = lastInvoice
      ? (invoiceItemsByInvoiceId.get(lastInvoice.id) ?? []).map(
          pickInvoiceItemSafeFields,
        )
      : [];

    const allInvoicesSafe = (clientInvoices ?? []).map(pickInvoiceSafeFields);
    const allInvoiceItemsSafe = (clientInvoices ?? []).flatMap((inv) =>
      (invoiceItemsByInvoiceId.get(inv.id) ?? []).map(pickInvoiceItemSafeFields),
    );

    const userDomains = (domainsByUser.get(client.id) ?? []).map(
      pickDomainSafeFields,
    );
    userDomains.sort((a, b) => compareDatesDesc(a.nextduedate, b.nextduedate));

    const userContacts = (contactsByUser.get(client.id) ?? []).map(pickContactSafeFields);
    const userAccounts = (accountsByUser.get(client.id) ?? []).map(pickAccountSafeFields);
    const userEmails = (emailsByUser.get(client.id) ?? []).map(pickEmailSafeFields);
    const userBillables = (billableByUser.get(client.id) ?? []).map(pickBillableSafeFields);
    const userTickets = (ticketsByUser.get(client.id) ?? []).map(pickTicketSafeFields);
    const userTicketReplies = userTickets.flatMap((t) =>
      (ticketRepliesByTicketId.get(t.legacyId) ?? []).map(pickTicketReplySafeFields),
    );

    const emailKey = normalizeEmail(client.email);
    const legacyUser = emailKey ? usersByEmail.get(emailKey) : null;
    const passwordHash = normalizeBcryptHash(legacyUser?.password);

    output.push({
      user: pickClientSafeFields(client),
      auth: passwordHash ? { passwordHash } : null,
      currentPlanIfActive: activeHosting
        ? pickHostingSafeFields(activeHosting, productName)
        : null,
      billing: {
        lastInvoice: lastInvoiceSafe,
        lastInvoiceItems: lastInvoiceItemsSafe,
        unpaidInvoices,
        unpaidTotal,
      },
      legacy: {
        contacts: userContacts,
        transactions: userAccounts,
        emails: userEmails,
        billableItems: userBillables,
        invoices: allInvoicesSafe,
        invoiceItems: allInvoiceItemsSafe,
        tickets: userTickets,
        ticketReplies: userTicketReplies,
      },
      domains: userDomains,
    });
  }

  output.sort((a, b) => (a.user?.id ?? 0) - (b.user?.id ?? 0));
  Object.defineProperty(output, "legacyProducts", {
    value: Array.from(productsById.values()).map((p) => ({
      id: p?.id ?? null,
      name: coerceString(p?.name) ?? null,
    })),
    enumerable: false,
  });
  return output;
}

async function importToDb(extracted, opts) {
  const { dryRun, sync } = opts;

  if (sync) {
    await sequelize.sync({ alter: true });
  }

  const summary = {
    users_total: extracted.length,
    users_skipped_no_email: 0,
    users_created: 0,
    users_updated: 0,
    hosting_created: 0,
    hosting_updated: 0,
    domains_created: 0,
    domains_updated: 0,
    invoices_created: 0,
    invoice_items_created: 0,
    admin_profiles_created: 0,
    admin_profiles_updated: 0,
    email_logs_created: 0,
    tickets_created: 0,
    ticket_replies_created: 0,
    plans_created: 0,
  };

  const legacyProducts = Array.isArray(extracted?.legacyProducts)
    ? extracted.legacyProducts
    : [];

  const planNames = new Set();
  for (const p of legacyProducts) {
    const name = coerceString(p?.name);
    if (name) planNames.add(name);
  }
  for (const row of extracted || []) {
    const name = coerceString(row?.currentPlanIfActive?.productName);
    if (name) planNames.add(name);
  }

  if (planNames.size) {
    const existingPlans = await Plan.findAll({
      attributes: ["whm_package_name"],
    });
    const existing = new Set(
      (existingPlans || [])
        .map((p) => (p?.get ? p.get({ plain: true }) : p))
        .map((p) => coerceString(p?.whm_package_name))
        .filter(Boolean)
    );

    for (const name of planNames) {
      if (existing.has(name)) continue;
      try {
        await Plan.create({
          name,
          whm_package_name: name,
          price: 0,
        });
        summary.plans_created++;
      } catch {}
    }
  }

  const mergeByLegacyId = (existing, incoming) => {
    const a = Array.isArray(existing) ? existing : [];
    const b = Array.isArray(incoming) ? incoming : [];
    const seen = new Set(a.map((x) => `${x?.source || "manual"}:${x?.legacyId ?? ""}`));
    const out = [...a];
    for (const item of b) {
      const key = `${item?.source || "legacy"}:${item?.legacyId ?? ""}`;
      if (item?.legacyId != null && !seen.has(key)) {
        out.push(item);
        seen.add(key);
      }
    }
    return out;
  };

  const mergeContacts = (existing, incoming) => {
    const a = Array.isArray(existing) ? existing : [];
    const b = Array.isArray(incoming) ? incoming : [];
    const seen = new Set(
      a
        .map((c) => normalizeEmail(c?.email))
        .filter(Boolean),
    );
    const out = [...a];
    for (const c of b) {
      const email = normalizeEmail(c?.email);
      if (email && !seen.has(email)) {
        out.push(c);
        seen.add(email);
      }
    }
    return out;
  };

  const run = async (transaction) => {
    const debugPath = path.join(process.cwd(), "migration_debug.log");
    fs.appendFileSync(
      debugPath,
      `[migration] starting import for ${extracted.length} rows\n`,
    );
    for (let idx = 0; idx < extracted.length; idx++) {
      if (idx < 3) {
        fs.appendFileSync(debugPath, `[migration] loop index ${idx}\n`);
      }
      const row = extracted[idx];
      const sourceUser = row?.user || {};
      const email = normalizeEmail(sourceUser.email);
      if (!email) {
        summary.users_skipped_no_email++;
        fs.appendFileSync(
          path.join(process.cwd(), "migration_debug.log"),
          `[migration] skip user without email (user_id=${sourceUser?.id ?? "unknown"})\n`,
        );
        continue;
      }

      const fullName = [sourceUser.firstname, sourceUser.lastname]
        .map(coerceString)
        .filter(Boolean)
        .join(" ");
      const name =
        fullName ||
        coerceString(sourceUser.companyname) ||
        coerceString(sourceUser.email) ||
        "User";

      const desiredUser = {
        name,
        email,
        phone: coerceString(sourceUser.phonenumber),
        address1: coerceString(sourceUser.address1),
        address2: coerceString(sourceUser.address2),
        city: coerceString(sourceUser.city),
        state: coerceString(sourceUser.state),
        postcode: coerceString(sourceUser.postcode),
        country: coerceString(sourceUser.country),
      };

      const migratedPasswordHash = normalizeBcryptHash(row?.auth?.passwordHash);

      const existing = await User.findOne({ where: { email }, transaction });
      let userId = null;

      if (!existing) {
        const created = await User.create(
          {
            ...desiredUser,
            password: migratedPasswordHash || null,
            role: "user",
          },
          { transaction },
        );
        userId = created.id;
        summary.users_created++;
      } else {
        userId = existing.id;
        const patch = {};
        if (!coerceString(existing.name) && desiredUser.name) patch.name = desiredUser.name;
        if (!coerceString(existing.phone) && desiredUser.phone) patch.phone = desiredUser.phone;
        if (!coerceString(existing.address1) && desiredUser.address1)
          patch.address1 = desiredUser.address1;
        if (!coerceString(existing.address2) && desiredUser.address2)
          patch.address2 = desiredUser.address2;
        if (!coerceString(existing.city) && desiredUser.city) patch.city = desiredUser.city;
        if (!coerceString(existing.state) && desiredUser.state) patch.state = desiredUser.state;
        if (!coerceString(existing.postcode) && desiredUser.postcode)
          patch.postcode = desiredUser.postcode;
        if (!coerceString(existing.country) && desiredUser.country)
          patch.country = desiredUser.country;
        if (!coerceString(existing.password) && migratedPasswordHash)
          patch.password = migratedPasswordHash;

        if (Object.keys(patch).length) {
          try {
            await existing.update(patch, { transaction });
          } catch (e) {
            const details = e?.original?.message || e?.message || String(e);
            const fields = Object.keys(patch).join(", ");
            throw new Error(
              `User update failed for ${email} (fields: ${fields}): ${details}`,
            );
          }
          summary.users_updated++;
        }
      }

      if (!userId) {
        fs.appendFileSync(
          path.join(process.cwd(), "migration_debug.log"),
          `[migration] skip user with missing id email=${email}\n`,
        );
        continue;
      }
      fs.appendFileSync(
        path.join(process.cwd(), "migration_debug.log"),
        `[migration] user=${email} legacyEmails=${
          Array.isArray(row?.legacy?.emails) ? row.legacy.emails.length : 0
        }\n`,
      );

      const activeHosting = row?.currentPlanIfActive || null;
      if (activeHosting) {
        const hostingPatch = {
          cpanel_username: coerceString(activeHosting.username),
          domain: coerceString(activeHosting.domain),
          email,
          password: null,
          status: statusToHostingStatus(activeHosting.domainstatus),
          service_name: coerceString(activeHosting.productName),
          billing_cycle: coerceString(activeHosting.billingcycle),
          next_due_date: parseDate(activeHosting.nextduedate),
          login_url: null,
        };

        const existingHosting = await HostingAccount.findOne({
          where: { user_id: userId },
          transaction,
        });

        if (!existingHosting) {
          await HostingAccount.create(
            { user_id: userId, ...hostingPatch },
            { transaction },
          );
          summary.hosting_created++;
        } else {
          const patch = {};
          if (!coerceString(existingHosting.cpanel_username) && hostingPatch.cpanel_username)
            patch.cpanel_username = hostingPatch.cpanel_username;
          if (!coerceString(existingHosting.domain) && hostingPatch.domain)
            patch.domain = hostingPatch.domain;
          if (!coerceString(existingHosting.email) && hostingPatch.email)
            patch.email = hostingPatch.email;
          if (!coerceString(existingHosting.service_name) && hostingPatch.service_name)
            patch.service_name = hostingPatch.service_name;
          if (!coerceString(existingHosting.billing_cycle) && hostingPatch.billing_cycle)
            patch.billing_cycle = hostingPatch.billing_cycle;
          if (!existingHosting.next_due_date && hostingPatch.next_due_date)
            patch.next_due_date = hostingPatch.next_due_date;
          if (!coerceString(existingHosting.status) && hostingPatch.status)
            patch.status = hostingPatch.status;

          if (Object.keys(patch).length) {
            await existingHosting.update(patch, { transaction });
            summary.hosting_updated++;
          }
        }
      }

      const primaryDomain = coerceString(activeHosting?.domain) || null;

      const combinedDomains = new Map();
      for (const d of row?.domains || []) {
        const domainName = coerceString(d?.domain);
        if (!domainName) continue;
        if (!combinedDomains.has(domainName)) combinedDomains.set(domainName, d);
      }
      if (activeHosting?.domain) {
        const domainName = coerceString(activeHosting.domain);
        if (domainName && !combinedDomains.has(domainName)) {
          combinedDomains.set(domainName, { domain: domainName });
        }
      }

      for (const d of combinedDomains.values()) {
        const domainName = coerceString(d.domain);
        if (!domainName) continue;

        const desiredDomain = {
          user_id: userId,
          domain: domainName,
          cpanel_username: coerceString(activeHosting?.username) || null,
          is_primary: primaryDomain ? domainName === primaryDomain : false,
          is_added_to_cpanel: false,
          type: coerceString(d.type) || "existing",
          status: domainStatusToStatus(d.status),
          registration_date: parseDate(d.registrationdate),
          expiry_date: parseDate(d.expirydate),
          next_due_date: parseDate(d.nextduedate),
          recurring_amount:
            typeof d.recurringamount === "number"
              ? d.recurringamount
              : Number(d.recurringamount || 0) || null,
          registration_period:
            typeof d.registrationperiod === "number"
              ? d.registrationperiod
              : Number(d.registrationperiod || 0) || null,
        };

        const existingDomain = await Domain.findOne({
          where: { user_id: userId, domain: domainName },
          transaction,
        });

        if (!existingDomain) {
          await Domain.create(desiredDomain, { transaction });
          summary.domains_created++;
        } else {
          const patch = {};
          if (!existingDomain.is_primary && desiredDomain.is_primary)
            patch.is_primary = true;
          if (!coerceString(existingDomain.type) && desiredDomain.type)
            patch.type = desiredDomain.type;
          if (!coerceString(existingDomain.status) && desiredDomain.status)
            patch.status = desiredDomain.status;
          if (!existingDomain.registration_date && desiredDomain.registration_date)
            patch.registration_date = desiredDomain.registration_date;
          if (!existingDomain.expiry_date && desiredDomain.expiry_date)
            patch.expiry_date = desiredDomain.expiry_date;
          if (!existingDomain.next_due_date && desiredDomain.next_due_date)
            patch.next_due_date = desiredDomain.next_due_date;
          if (!existingDomain.recurring_amount && desiredDomain.recurring_amount)
            patch.recurring_amount = desiredDomain.recurring_amount;
          if (!existingDomain.registration_period && desiredDomain.registration_period)
            patch.registration_period = desiredDomain.registration_period;
          if (!coerceString(existingDomain.cpanel_username) && desiredDomain.cpanel_username)
            patch.cpanel_username = desiredDomain.cpanel_username;

          if (Object.keys(patch).length) {
            await existingDomain.update(patch, { transaction });
            summary.domains_updated++;
          }
        }
      }

      const legacy = row?.legacy || {};

      const ensureAdminProfile = async () => {
        let adminProfile = await UserAdminProfile.findOne({
          where: { user_id: userId },
          transaction,
        });
        if (!adminProfile) {
          adminProfile = await UserAdminProfile.create(
            {
              user_id: userId,
              profile_json: JSON.stringify({}),
              contacts_json: JSON.stringify([]),
            },
            { transaction },
          );
          summary.admin_profiles_created++;
        }
        return adminProfile;
      };

      const adminProfile = await ensureAdminProfile();
      const existingProfile = (() => {
        try {
          return adminProfile.profile_json ? JSON.parse(adminProfile.profile_json) : {};
        } catch {
          return {};
        }
      })();
      const existingContacts = (() => {
        try {
          return adminProfile.contacts_json ? JSON.parse(adminProfile.contacts_json) : [];
        } catch {
          return [];
        }
      })();

      const mergedProfile = {
        ...(existingProfile || {}),
        transactions: mergeByLegacyId(existingProfile?.transactions, legacy?.transactions),
        billableItems: mergeByLegacyId(existingProfile?.billableItems, legacy?.billableItems),
      };

      const mergedContacts = mergeContacts(existingContacts, legacy?.contacts);

      const shouldUpdateProfile =
        JSON.stringify(existingProfile || {}) !== JSON.stringify(mergedProfile) ||
        JSON.stringify(existingContacts || []) !== JSON.stringify(mergedContacts);

      if (shouldUpdateProfile) {
        adminProfile.profile_json = JSON.stringify(mergedProfile);
        adminProfile.contacts_json = JSON.stringify(mergedContacts);
        await adminProfile.save({ transaction });
        summary.admin_profiles_updated++;
      }

      for (const m of legacy?.emails || []) {
        const legacyId = m?.legacyId ?? m?.id ?? null;
        const fallbackKey = [
          userId,
          coerceString(m?.createdAt) || "",
          coerceString(m?.to) || email || "",
          coerceString(m?.subject) || "",
        ].join("|");
        const legacyKey =
          legacyId != null && legacyId !== ""
            ? `tblemails:${legacyId}`
            : `tblemails_fallback:${fallbackKey}`.slice(0, 240);
        const existingEmail = await EmailLog.findOne({
          where: { legacy_key: legacyKey },
          transaction,
        });
        if (existingEmail) {
          fs.appendFileSync(
            path.join(process.cwd(), "migration_debug.log"),
            `[migration] skip existing legacy_key=${legacyKey}\n`,
          );
          continue;
        }

        await EmailLog.create(
          {
            user_id: userId,
            direction: "outgoing",
            source: "legacy",
            legacy_key: legacyKey,
            from_email: null,
            to_email: coerceString(m?.to) || email,
            subject: coerceString(m?.subject) || null,
            body_text: coerceString(m?.body) || null,
            body_html: null,
            status: "sent",
            createdAt: parseDate(m?.createdAt) || undefined,
            updatedAt: parseDate(m?.createdAt) || undefined,
          },
          { transaction },
        );
        summary.email_logs_created++;
      }

      for (const inv of legacy?.invoices || []) {
        const legacyId = inv?.id;
        if (!legacyId) continue;
        const invoiceNumber = `WHMCS-${legacyId}`;
        const existingInvoice = await Invoice.findOne({
          where: { user_id: userId, invoice_number: invoiceNumber },
          transaction,
        });
        let invoiceRow = existingInvoice;
        if (!invoiceRow) {
          invoiceRow = await Invoice.create(
            {
              user_id: userId,
              order_id: null,
              invoice_number: invoiceNumber,
              customer_name: name,
              email,
              amount:
                typeof inv.total === "number" ? inv.total : Number(inv.total || 0) || 0,
              status: coerceString(inv.status) || "unknown",
              pdf_path: null,
              invoice_type: "legacy",
              meta_json: JSON.stringify({ legacyInvoiceId: legacyId }),
            },
            { transaction },
          );
          summary.invoices_created++;
        }

        const paymentId = invoiceNumber;
        const existingOrder = await Order.findOne({
          where: { user_id: userId, payment_id: paymentId },
          transaction,
        });

        if (!existingOrder) {
          const activeHosting = row?.currentPlanIfActive || null;
          const domainFromHosting = coerceString(activeHosting?.domain) || null;
          const fallbackDomain =
            coerceString(row?.domains?.[0]?.domain) ||
            coerceString(row?.domains?.[0]?.name) ||
            null;
          const domain = domainFromHosting || fallbackDomain;

          const billingCycle = coerceString(activeHosting?.billingcycle) || null;
          const productName = coerceString(activeHosting?.productName) || null;

          let planId = null;
          if (productName) {
            const plan =
              (await Plan.findOne({
                where: { whm_package_name: productName },
                transaction,
              })) ||
              (await Plan.findOne({
                where: { name: productName },
                transaction,
              }));
            planId = plan?.id || null;
          }

          const statusRaw = String(inv?.status || "").toLowerCase();
          const isPaid = statusRaw === "paid";

          await Order.create(
            {
              user_id: userId,
              plan_id: planId,
              domain: domain,
              billing_cycle: billingCycle,
              plan_price: Number(invoiceRow.amount || 0) || 0,
              domain_price: 0,
              total_price: Number(invoiceRow.amount || 0) || 0,
              status: isPaid ? "paid" : "pending",
              domain_status: "active",
              type: "hosting",
              payment_id: paymentId,
              payment_gateway: "legacy",
              createdAt: parseDate(inv?.createdAt) || undefined,
              updatedAt: parseDate(inv?.updatedAt) || parseDate(inv?.createdAt) || undefined,
            },
            { transaction },
          );
        }
      }

      const invoiceIdByLegacyId = new Map();
      const invoices = await Invoice.findAll({
        where: { user_id: userId },
        transaction,
      });
      for (const inv of invoices) {
        const m = typeof inv.invoice_number === "string" ? inv.invoice_number.match(/^WHMCS-(\d+)$/) : null;
        if (m) invoiceIdByLegacyId.set(Number(m[1]), inv.id);
      }

      for (const item of legacy?.invoiceItems || []) {
        const legacyInvoiceId = Number(item?.invoiceid);
        const invoice_id = invoiceIdByLegacyId.get(legacyInvoiceId);
        if (!invoice_id) continue;
        const description = coerceString(item.description) || "Item";
        const amount =
          typeof item.amount === "number" ? item.amount : Number(item.amount || 0) || 0;

        const exists = await InvoiceItem.findOne({
          where: { invoice_id, description, amount },
          transaction,
        });
        if (!exists) {
          await InvoiceItem.create(
            { invoice_id, description, qty: 1, rate: amount, amount },
            { transaction },
          );
          summary.invoice_items_created++;
        }
      }

      const ticketIdByLegacyId = new Map();
      for (const t of legacy?.tickets || []) {
        const ticketKey = coerceString(t.ticket_id);
        if (!ticketKey) continue;
        const existingTicket = await Ticket.findOne({
          where: { ticket_id: ticketKey },
          transaction,
        });

        let createdOrExisting = existingTicket;
        if (!createdOrExisting) {
          createdOrExisting = await Ticket.create(
            {
              ticket_id: ticketKey,
              subject: coerceString(t.subject) || "Ticket",
              department: t.department != null ? String(t.department) : null,
              priority: coerceString(t.priority) || null,
              status: coerceString(t.status) || "Open",
              user_id: userId,
              admin_id: null,
              client_name: name,
              client_email: email,
              cc_recipients: coerceString(t.cc) || "",
              createdAt: parseDate(t.createdAt) || new Date(),
              updatedAt: parseDate(t.updatedAt) || new Date(),
            },
            { transaction },
          );
          summary.tickets_created++;
        }
        if (t?.legacyId != null) {
          ticketIdByLegacyId.set(Number(t.legacyId), createdOrExisting.id);
        }
      }

      for (const r of legacy?.ticketReplies || []) {
        const legacyTicketId = Number(r?.tid);
        const ticket_id = ticketIdByLegacyId.get(legacyTicketId);
        if (!ticket_id) continue;
        const message = coerceString(r.message) || "";
        if (!message) continue;
        const createdAt = parseDate(r.createdAt) || null;
        const senderIsAdmin = coerceString(r.admin) ? true : false;
        const attachmentRaw = coerceString(r.attachment);
        const attachments = attachmentRaw
          ? JSON.stringify(attachmentRaw.split("|").filter(Boolean))
          : null;

        const exists = await TicketReply.findOne({
          where: { ticket_id, message, sender_type: senderIsAdmin ? "admin" : "user" },
          transaction,
        });
        if (!exists) {
          await TicketReply.create(
            {
              ticket_id,
              message,
              sender_type: senderIsAdmin ? "admin" : "user",
              user_id: senderIsAdmin ? null : userId,
              admin_id: null,
              attachments,
              createdAt: createdAt || undefined,
              updatedAt: createdAt || undefined,
            },
            { transaction },
          );
          summary.ticket_replies_created++;
        }
      }
    }
  };

  if (dryRun) {
    await sequelize
      .transaction(async (t) => {
        await run(t);
        throw new Error("__DRY_RUN_ROLLBACK__");
      })
      .catch((err) => {
        if (err?.message !== "__DRY_RUN_ROLLBACK__") throw err;
      });
  } else {
    await sequelize.transaction(async (t) => {
      await run(t);
    });
  }

  return summary;
}

async function runMigration(options = {}) {
  const sqlPath = options.sqlPath || DEFAULT_SQL_PATH;
  const extracted = await extractFromSql(sqlPath);
  const summary = await importToDb(extracted, {
    dryRun: Boolean(options.dryRun),
    sync: Boolean(options.sync),
  });
  return { summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sqlPath = args.sqlPath;

  if (!fs.existsSync(sqlPath)) {
    process.stderr.write(`SQL file not found: ${sqlPath}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const extracted = await extractFromSql(sqlPath);
    const stats = extracted.reduce(
      (acc, row) => {
        acc.rows += 1;
        acc.domains += Array.isArray(row?.domains) ? row.domains.length : 0;
        acc.legacy.contacts += Array.isArray(row?.legacy?.contacts) ? row.legacy.contacts.length : 0;
        acc.legacy.transactions += Array.isArray(row?.legacy?.transactions)
          ? row.legacy.transactions.length
          : 0;
        acc.legacy.emails += Array.isArray(row?.legacy?.emails) ? row.legacy.emails.length : 0;
        acc.legacy.billableItems += Array.isArray(row?.legacy?.billableItems)
          ? row.legacy.billableItems.length
          : 0;
        acc.legacy.invoices += Array.isArray(row?.legacy?.invoices) ? row.legacy.invoices.length : 0;
        acc.legacy.invoiceItems += Array.isArray(row?.legacy?.invoiceItems)
          ? row.legacy.invoiceItems.length
          : 0;
        acc.legacy.tickets += Array.isArray(row?.legacy?.tickets) ? row.legacy.tickets.length : 0;
        acc.legacy.ticketReplies += Array.isArray(row?.legacy?.ticketReplies)
          ? row.legacy.ticketReplies.length
          : 0;
        return acc;
      },
      {
        rows: 0,
        domains: 0,
        legacy: {
          contacts: 0,
          transactions: 0,
          emails: 0,
          billableItems: 0,
          invoices: 0,
          invoiceItems: 0,
          tickets: 0,
          ticketReplies: 0,
        },
      },
    );

    if (args.stats && !args.import && !args.outPath) {
      console.log(JSON.stringify({ ok: true, stats }, null, 2));
      return;
    }

    if (args.outPath) {
      const outAbs = path.isAbsolute(args.outPath)
        ? args.outPath
        : path.join(process.cwd(), args.outPath);
      const payload = args.includePasswordHash
        ? extracted
        : extracted.map((row) => {
            const { auth, ...rest } = row;
            return rest;
          });
      fs.writeFileSync(outAbs, JSON.stringify(payload, null, 2), "utf8");
    }

    if (args.import) {
      const summary = await importToDb(extracted, {
        dryRun: args.dryRun,
        sync: args.sync,
      });
      console.log(JSON.stringify({ ok: true, summary, stats }, null, 2));
      return;
    }

    const payload = args.includePasswordHash
      ? extracted
      : extracted.map((row) => {
          const { auth, ...rest } = row;
          return rest;
        });
    console.log(JSON.stringify({ ok: true, stats, data: payload }, null, 2));
  } finally {
    await sequelize.close();
  }
}

module.exports = {
  DEFAULT_SQL_PATH,
  extractFromSql,
  importToDb,
  runMigration,
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
    process.exitCode = 1;
  });
}
