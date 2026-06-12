import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_CUSTOMER_SEGMENT,
  normalizeCustomerSegment,
} from "../services/customerSegments.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  })
);

const csvPath = path.resolve(args.get("file") || "C:/Users/Luigi/Desktop/Customer.csv");
const partnerId = Number(args.get("partner-id") || 1);
const execute = args.has("execute");
const clean = args.has("clean");

const validOrigins = new Set(["PHONE", "WALKIN", "MARKETPLACE", "QR", "OTHER"]);

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

function parseFloatOrNull(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function parseIntOrNull(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number.parseInt(text, 10);
  return Number.isFinite(number) ? number : null;
}

function parseBool(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function normalizeCustomer(row) {
  const code = cleanText(row.code);
  const phone = cleanText(row.phone);
  const origin = validOrigins.has(row.origin) ? row.origin : "OTHER";
  const segment = normalizeCustomerSegment(row.segment, DEFAULT_CUSTOMER_SEGMENT);
  const createdAt = parseDate(row.createdAt);
  const updatedAt = parseDate(row.updatedAt);
  const segmentUpdatedAt = parseDate(row.segmentUpdatedAt);
  const restrictedAt = parseDate(row.restrictedAt);

  return {
    legacyId: cleanText(row.id),
    data: {
      code,
      partnerId,
      name: cleanText(row.name),
      phone,
      email: cleanText(row.email),
      address_1: cleanText(row.address_1) || "(NO ADDRESS)",
      portal: cleanText(row.portal),
      observations: cleanText(row.observations),
      lat: parseFloatOrNull(row.lat),
      lng: parseFloatOrNull(row.lng),
      origin,
      daysOff: parseIntOrNull(row.daysOff),
      isRestricted: parseBool(row.isRestricted),
      restrictedAt,
      restrictionReason: cleanText(row.restrictionReason),
      segment,
      segmentUpdatedAt,
      createdAt: createdAt || undefined,
      updatedAt: updatedAt || undefined,
    },
  };
}

async function exportBackup() {
  const backupDir = path.resolve(__dirname, "../_db_backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(backupDir, `partner-${partnerId}-customers-sales-${stamp}.json`);
  const [customers, sales] = await Promise.all([
    prisma.customer.findMany({ where: { partnerId }, orderBy: { id: "asc" } }),
    prisma.sale.findMany({ where: { partnerId }, orderBy: { id: "asc" } }),
  ]);
  fs.writeFileSync(file, JSON.stringify({ partnerId, customers, sales }, null, 2));
  return { file, customers: customers.length, sales: sales.length };
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner) {
    throw new Error(`Partner ${partnerId} not found`);
  }

  const parsed = toObjects(parseCsv(fs.readFileSync(csvPath, "utf8")));
  const customers = parsed.map(normalizeCustomer);
  const missingCode = customers.filter((row) => !row.data.code).length;
  const duplicateCodes = new Map();
  customers.forEach((row) => {
    duplicateCodes.set(row.data.code, (duplicateCodes.get(row.data.code) || 0) + 1);
  });
  const duplicated = [...duplicateCodes.entries()].filter(([code, count]) => code && count > 1);

  const before = {
    customers: await prisma.customer.count({ where: { partnerId } }),
    sales: await prisma.sale.count({ where: { partnerId } }),
  };
  const existingCodes = await prisma.customer.findMany({
    where: { code: { in: customers.map((row) => row.data.code).filter(Boolean) } },
    select: { code: true, partnerId: true },
  });
  const codeConflicts = existingCodes.filter((row) => row.partnerId !== partnerId);

  const summary = {
    mode: execute ? "execute" : "dry-run",
    partner: { id: partner.id, slug: partner.slug, name: partner.name },
    csvPath,
    rows: customers.length,
    missingCode,
    duplicatedCodes: duplicated.length,
    codeConflicts: codeConflicts.length,
    clean,
    before,
  };

  if (!execute) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (missingCode || duplicated.length) {
    throw new Error("CSV has missing or duplicated customer codes");
  }
  if (codeConflicts.length) {
    throw new Error(
      `CSV has ${codeConflicts.length} customer codes already used by another partner`
    );
  }

  const backup = await exportBackup();

  const result = await prisma.$transaction(
    async (tx) => {
      const deleted = { sales: 0, customers: 0 };

      if (clean) {
        await tx.couponRedemption.updateMany({
          where: { partnerId },
          data: { saleId: null, customerId: null },
        });
        await tx.coupon.updateMany({
          where: { partnerId, assignedToId: { not: null } },
          data: { assignedToId: null },
        });
        await tx.gamePlay.updateMany({
          where: { partnerId, playerId: { not: null } },
          data: { playerId: null },
        });

        const salesDelete = await tx.sale.deleteMany({ where: { partnerId } });
        const customerDelete = await tx.customer.deleteMany({ where: { partnerId } });
        deleted.sales = salesDelete.count;
        deleted.customers = customerDelete.count;
      }

      let created = 0;
      let updated = 0;

      if (clean) {
        const insert = await tx.customer.createMany({
          data: customers.map((row) => row.data),
        });
        created = insert.count;
      } else {
        for (const row of customers) {
          const existing = await tx.customer.findUnique({ where: { code: row.data.code } });
          if (existing) {
            await tx.customer.update({ where: { code: row.data.code }, data: row.data });
            updated += 1;
          } else {
            await tx.customer.create({ data: row.data });
            created += 1;
          }
        }
      }

      return { deleted, created, updated };
    },
    {
      maxWait: 10000,
      timeout: 60000,
    }
  );

  const after = {
    customers: await prisma.customer.count({ where: { partnerId } }),
    sales: await prisma.sale.count({ where: { partnerId } }),
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
