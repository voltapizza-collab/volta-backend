import { PrismaClient } from "@prisma/client";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const envPath = path.join(backendRoot, ".env");

const PRICE_ADJUSTMENT_RULES_MIGRATION =
  "20260606130000_add_partner_price_adjustment_rules";
const DIRECT_DISCOUNT_DAILY_OVERRIDES_MIGRATION =
  "20260903170000_add_direct_discount_daily_overrides";

const RECOVERABLE_FAILED_MIGRATIONS = [
  {
    name: PRICE_ADJUSTMENT_RULES_MIGRATION,
    tableName: "Partner",
    columnName: "priceAdjustmentRules",
  },
  {
    name: DIRECT_DISCOUNT_DAILY_OVERRIDES_MIGRATION,
    tableName: "DirectDiscount",
    columnName: "dailyOverrides",
  },
];

if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  envLines.forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) return;

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const normalizedValue = rawValue.replace(/^"(.*)"$/, "$1");

    if (!(key in process.env)) {
      process.env[key] = normalizedValue;
    }
  });
}

function runPrisma(args) {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npxCommand, ["prisma", ...args], {
    cwd: backendRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;

  return result;
}

const escapeSqlIdentifier = (value) => String(value).replace(/`/g, "``");
const escapeSqlString = (value) => String(value).replace(/'/g, "''");

async function hasColumn(prisma, tableName, columnName) {
  const safeTableName = escapeSqlIdentifier(tableName);
  const safeColumnName = escapeSqlString(columnName);
  const rows = await prisma.$queryRawUnsafe(
    `SHOW COLUMNS FROM \`${safeTableName}\` LIKE '${safeColumnName}'`
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function canResolveColumnMigration({ tableName, columnName }) {
  const prisma = new PrismaClient();

  try {
    return await hasColumn(prisma, tableName, columnName);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

let deployResult = runPrisma(["migrate", "deploy"]);

if (deployResult.status === 0) {
  process.exit(0);
}

const output = `${deployResult.stdout || ""}\n${deployResult.stderr || ""}`;
const recoverableMigration = RECOVERABLE_FAILED_MIGRATIONS.find(
  (migration) => output.includes("P3009") && output.includes(migration.name)
);

if (!recoverableMigration) {
  process.exit(deployResult.status || 1);
}

if (!(await canResolveColumnMigration(recoverableMigration))) {
  console.error(
    `[db-migrate] ${recoverableMigration.name} failed, but ${recoverableMigration.tableName}.${recoverableMigration.columnName} is missing. Refusing to mark it applied.`
  );
  process.exit(deployResult.status || 1);
}

console.log(`[db-migrate] Resolving failed migration ${recoverableMigration.name}`);
const resolveResult = runPrisma([
  "migrate",
  "resolve",
  "--applied",
  recoverableMigration.name,
]);

if (resolveResult.status !== 0) {
  process.exit(resolveResult.status || 1);
}

deployResult = runPrisma(["migrate", "deploy"]);
process.exit(deployResult.status || 0);
