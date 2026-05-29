import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  })
);

const salesCsvPath = path.resolve(args.get("file") || "C:/Users/Luigi/Desktop/Sale2.csv");
const customersCsvPath = path.resolve(
  args.get("customers-file") || "C:/Users/Luigi/Desktop/Customer.csv"
);
const partnerId = Number(args.get("partner-id") || 1);
const execute = args.has("execute");
const clean = args.has("clean");
const defaultStoreId = Number(args.get("default-store-id") || 1);

const validDeliveries = new Set(["PICKUP", "COURIER", "MARKETPLACE", "OTHER"]);
const validStatuses = new Set(["PENDING", "AWAITING_PAYMENT", "PAID", "CANCELED"]);
const validChannels = new Set(["WHATSAPP", "PHONE", "WEB"]);

function parseStoreMap(value) {
  const map = new Map();
  String(value || "2:1,3:1")
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .forEach((chunk) => {
      const [from, to] = chunk.split(":").map((part) => Number(part.trim()));
      if (Number.isInteger(from) && Number.isInteger(to)) map.set(String(from), to);
    });
  return map;
}

const storeMap = parseStoreMap(args.get("store-map"));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function toObjects(rows) {
  const headers = rows[0] || [];
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
    );
}

function cleanText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parseDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseFloatOrZero(value) {
  const text = cleanText(value);
  if (!text) return 0;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function parseFloatOrNull(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function parseBool(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function parseJson(value, fallback, stats, field, code) {
  const text = cleanText(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    stats.jsonErrors.push({ code, field });
    return fallback;
  }
}

function phoneBase9(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.slice(-9);
}

function normalizeProducts(products, menuById) {
  if (!Array.isArray(products)) return [];
  return products.map((item) => {
    if (!item || typeof item !== "object") return item;
    const pizzaId = Number(item.pizzaId ?? item.menuPizzaId ?? item.productId);
    const menu = Number.isInteger(pizzaId) ? menuById.get(pizzaId) : null;
    return {
      ...item,
      ...(menu && !item.name ? { name: menu.name } : {}),
      ...(Number.isInteger(pizzaId) ? { legacyPizzaId: pizzaId } : {}),
    };
  });
}

async function exportBackup() {
  const backupDir = path.resolve(__dirname, "../_db_backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(backupDir, `partner-${partnerId}-sales-before-import-${stamp}.json`);
  const sales = await prisma.sale.findMany({ where: { partnerId }, orderBy: { id: "asc" } });
  fs.writeFileSync(file, JSON.stringify({ partnerId, sales }, null, 2));
  return { file, sales: sales.length };
}

async function main() {
  if (!fs.existsSync(salesCsvPath)) throw new Error(`Sales CSV not found: ${salesCsvPath}`);
  if (!fs.existsSync(customersCsvPath)) {
    throw new Error(`Customer CSV not found: ${customersCsvPath}`);
  }

  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner) throw new Error(`Partner ${partnerId} not found`);

  const stores = await prisma.store.findMany({
    where: { partnerId },
    select: { id: true, slug: true, storeName: true },
  });
  const validStoreIds = new Set(stores.map((store) => store.id));

  const legacyCustomerToCode = new Map(
    toObjects(parseCsv(fs.readFileSync(customersCsvPath, "utf8"))).map((row) => [
      String(row.id),
      row.code,
    ])
  );

  const dbCustomers = await prisma.customer.findMany({
    where: { partnerId },
    select: { id: true, code: true, phone: true },
  });
  const customerByCode = new Map(dbCustomers.map((customer) => [customer.code, customer.id]));
  const customerByBase9 = new Map();
  dbCustomers.forEach((customer) => {
    const base9 = phoneBase9(customer.phone);
    if (base9 && !customerByBase9.has(base9)) customerByBase9.set(base9, customer.id);
  });

  const menuRows = await prisma.menuPizza.findMany({
    where: { partnerId },
    select: { id: true, name: true },
  });
  const menuById = new Map(menuRows.map((row) => [row.id, row]));

  const rows = toObjects(parseCsv(fs.readFileSync(salesCsvPath, "utf8")));
  const stats = {
    missingCode: 0,
    duplicateCodes: 0,
    jsonErrors: [],
    missingCustomerId: 0,
    customerLinkedByLegacy: 0,
    customerLinkedByPhone: 0,
    customerUnlinked: 0,
    unmappedStores: 0,
  };

  const codeCounts = new Map();
  rows.forEach((row) => {
    const code = cleanText(row.code);
    if (!code) stats.missingCode += 1;
    codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
  });
  stats.duplicateCodes = [...codeCounts.entries()].filter(
    ([code, count]) => code && count > 1
  ).length;

  const sales = rows.map((row) => {
    const code = cleanText(row.code);
    const legacyCustomerId = cleanText(row.customerId);
    const rawCustomerData = parseJson(row.customerData, {}, stats, "customerData", code);
    const rawProducts = parseJson(row.products, [], stats, "products", code);
    const extras = parseJson(row.extras, [], stats, "extras", code);

    let customerId = null;
    if (legacyCustomerId) {
      const customerCode = legacyCustomerToCode.get(legacyCustomerId);
      customerId = customerCode ? customerByCode.get(customerCode) || null : null;
      if (customerId) stats.customerLinkedByLegacy += 1;
    } else {
      stats.missingCustomerId += 1;
    }

    if (!customerId) {
      const base9 = phoneBase9(rawCustomerData.phone);
      customerId = base9 ? customerByBase9.get(base9) || null : null;
      if (customerId) stats.customerLinkedByPhone += 1;
    }

    if (!customerId) stats.customerUnlinked += 1;

    const mappedStoreId = storeMap.get(String(row.storeId)) || defaultStoreId;
    if (!validStoreIds.has(mappedStoreId)) stats.unmappedStores += 1;

    const date = parseDate(row.date) || parseDate(row.createdAt) || new Date();
    const createdAt = parseDate(row.createdAt) || date;
    const customerData =
      rawCustomerData && typeof rawCustomerData === "object" && !Array.isArray(rawCustomerData)
        ? rawCustomerData
        : {};

    return {
      code,
      date,
      partnerId,
      storeId: mappedStoreId,
      customerId,
      type: cleanText(row.type) || "LOCAL",
      delivery: validDeliveries.has(row.delivery) ? row.delivery : "OTHER",
      customerData: {
        ...customerData,
        legacySaleId: cleanText(row.id),
        legacyCustomerId,
        legacyStoreId: cleanText(row.storeId),
        deliveredAt: cleanText(row.deliveredAt),
        scheduledFor: cleanText(row.scheduledFor),
        importedFrom: path.basename(salesCsvPath),
      },
      products: normalizeProducts(rawProducts, menuById),
      extras: Array.isArray(extras) ? extras : [],
      totalProducts: parseFloatOrZero(row.totalProducts),
      discounts: parseFloatOrZero(row.discounts),
      total: parseFloatOrZero(row.total),
      processed: parseBool(row.processed),
      notes: cleanText(row.notes),
      createdAt,
      status: validStatuses.has(row.status) ? row.status : "PENDING",
      channel: validChannels.has(row.channel) ? row.channel : "WHATSAPP",
      currency: cleanText(row.currency) || partner.currency || "EUR",
      address_1: cleanText(row.address_1),
      lat: parseFloatOrNull(row.lat),
      lng: parseFloatOrNull(row.lng),
      incentiveAmount: parseFloatOrZero(row.incentiveAmount),
    };
  });

  const existingCodes = await prisma.sale.findMany({
    where: { code: { in: sales.map((sale) => sale.code).filter(Boolean) } },
    select: { code: true, partnerId: true },
  });
  const codeConflicts = existingCodes.filter((row) => row.partnerId !== partnerId);

  const before = {
    sales: await prisma.sale.count({ where: { partnerId } }),
    customers: await prisma.customer.count({ where: { partnerId } }),
  };

  const summary = {
    mode: execute ? "execute" : "dry-run",
    partner: { id: partner.id, slug: partner.slug, name: partner.name },
    stores,
    storeMap: Object.fromEntries(storeMap.entries()),
    salesCsvPath,
    customersCsvPath,
    rows: rows.length,
    clean,
    before,
    stats: { ...stats, jsonErrors: stats.jsonErrors.length },
    codeConflicts: codeConflicts.length,
  };

  if (!execute) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (stats.missingCode || stats.duplicateCodes || stats.jsonErrors.length) {
    throw new Error("Sales CSV has missing codes, duplicated codes, or invalid JSON");
  }
  if (stats.unmappedStores) throw new Error("Some sales mapped to invalid store IDs");
  if (codeConflicts.length) {
    throw new Error(`CSV has ${codeConflicts.length} sale codes used by another partner`);
  }

  const backup = await exportBackup();

  const result = await prisma.$transaction(
    async (tx) => {
      const deleted = { sales: 0 };
      if (clean) {
        await tx.couponRedemption.updateMany({
          where: { partnerId, saleId: { not: null } },
          data: { saleId: null },
        });
        const salesDelete = await tx.sale.deleteMany({ where: { partnerId } });
        deleted.sales = salesDelete.count;
      }

      const insert = await tx.sale.createMany({ data: sales });
      return { deleted, created: insert.count };
    },
    { maxWait: 10000, timeout: 60000 }
  );

  const after = {
    sales: await prisma.sale.count({ where: { partnerId } }),
    customers: await prisma.customer.count({ where: { partnerId } }),
  };

  console.log(JSON.stringify({ ...summary, backup, result, after }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
