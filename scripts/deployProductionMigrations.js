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

async function hasColumn(prisma, tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
    columnName
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function canResolvePriceAdjustmentRulesMigration() {
  const prisma = new PrismaClient();

  try {
    return await hasColumn(prisma, "Partner", "priceAdjustmentRules");
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

let deployResult = runPrisma(["migrate", "deploy"]);

if (deployResult.status === 0) {
  process.exit(0);
}

const output = `${deployResult.stdout || ""}\n${deployResult.stderr || ""}`;
const isKnownPriceAdjustmentFailure =
  output.includes("P3009") && output.includes(PRICE_ADJUSTMENT_RULES_MIGRATION);

if (!isKnownPriceAdjustmentFailure) {
  process.exit(deployResult.status || 1);
}

if (!(await canResolvePriceAdjustmentRulesMigration())) {
  console.error(
    `[db-migrate] ${PRICE_ADJUSTMENT_RULES_MIGRATION} failed, but Partner.priceAdjustmentRules is missing. Refusing to mark it applied.`
  );
  process.exit(deployResult.status || 1);
}

console.log(`[db-migrate] Resolving failed migration ${PRICE_ADJUSTMENT_RULES_MIGRATION}`);
const resolveResult = runPrisma([
  "migrate",
  "resolve",
  "--applied",
  PRICE_ADJUSTMENT_RULES_MIGRATION,
]);

if (resolveResult.status !== 0) {
  process.exit(resolveResult.status || 1);
}

deployResult = runPrisma(["migrate", "deploy"]);
process.exit(deployResult.status || 0);
