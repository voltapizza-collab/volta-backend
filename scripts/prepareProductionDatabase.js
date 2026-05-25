import { PrismaClient } from "@prisma/client";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const envPath = path.join(backendRoot, ".env");

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

const STOREFRONT_MODE_MIGRATION = "20260525120000_add_storefront_mode";

const prisma = new PrismaClient();

async function ensureStorefrontModeColumn() {
  const rows = await prisma.$queryRawUnsafe(
    "SHOW COLUMNS FROM `Partner` LIKE 'storefrontMode'"
  );

  if (Array.isArray(rows) && rows.length > 0) return;

  try {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Partner` ADD COLUMN `storefrontMode` VARCHAR(64) NULL"
    );
    console.log("[db-prepare] Added Partner.storefrontMode");
  } catch (error) {
    const message = `${error?.message || ""} ${error?.meta?.message || ""}`;
    if (!message.includes("Duplicate column name")) {
      throw error;
    }
  }
}

async function getMigrationRecord(name) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT migration_name, finished_at, rolled_back_at FROM `_prisma_migrations` WHERE migration_name = ? ORDER BY started_at DESC LIMIT 1",
      name
    );
    return Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    console.warn("[db-prepare] Could not inspect _prisma_migrations:", error?.message || error);
    return null;
  }
}

function resolveFailedMigration(name) {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    npxCommand,
    ["prisma", "migrate", "resolve", "--applied", name],
    {
      cwd: backendRoot,
      stdio: "inherit",
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`prisma migrate resolve failed with exit code ${result.status}`);
  }
}

try {
  await ensureStorefrontModeColumn();

  const migration = await getMigrationRecord(STOREFRONT_MODE_MIGRATION);
  const isFailed =
    migration &&
    migration.finished_at == null &&
    migration.rolled_back_at == null;

  if (isFailed) {
    console.log(`[db-prepare] Resolving failed migration ${STOREFRONT_MODE_MIGRATION}`);
    await prisma.$disconnect();
    resolveFailedMigration(STOREFRONT_MODE_MIGRATION);
  }
} finally {
  await prisma.$disconnect().catch(() => {});
}
