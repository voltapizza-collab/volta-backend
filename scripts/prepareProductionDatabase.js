import { PrismaClient } from "@prisma/client";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ensureIngredientMediaColumns } from "../services/ingredientMediaColumns.js";

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
const TRACKING_NOTIFICATION_SETTINGS_MIGRATION =
  "20260529123000_add_tracking_notification_settings";
const INGREDIENT_MEDIA_MIGRATION = "20260530102000_add_ingredient_media_fields";
const PRICE_ADJUSTMENT_RULES_MIGRATION =
  "20260606130000_add_partner_price_adjustment_rules";

const prisma = new PrismaClient();

async function hasColumn(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
    columnName
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function ensureStorefrontModeColumn() {
  if (await hasColumn("Partner", "storefrontMode")) return;

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

async function ensureTrackingNotificationSettingsColumn() {
  if (await hasColumn("Partner", "trackingNotificationSettings")) return;

  try {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Partner` ADD COLUMN `trackingNotificationSettings` JSON NULL"
    );
    console.log("[db-prepare] Added Partner.trackingNotificationSettings");
  } catch (error) {
    const message = `${error?.message || ""} ${error?.meta?.message || ""}`;
    if (!message.includes("Duplicate column name")) {
      throw error;
    }
  }
}

async function ensurePriceAdjustmentRulesColumn() {
  if (await hasColumn("Partner", "priceAdjustmentRules")) return true;

  try {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Partner` ADD COLUMN `priceAdjustmentRules` JSON NULL"
    );
    console.log("[db-prepare] Added Partner.priceAdjustmentRules");
    return true;
  } catch (error) {
    const message = `${error?.message || ""} ${error?.meta?.message || ""}`;
    if (!message.includes("Duplicate column name")) {
      throw error;
    }
    return true;
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
      shell: process.platform === "win32",
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
  await ensureTrackingNotificationSettingsColumn();
  const priceAdjustmentRulesColumnReady = await ensurePriceAdjustmentRulesColumn();
  await ensureIngredientMediaColumns(prisma);

  const migrationNames = [
    STOREFRONT_MODE_MIGRATION,
    TRACKING_NOTIFICATION_SETTINGS_MIGRATION,
    INGREDIENT_MEDIA_MIGRATION,
    PRICE_ADJUSTMENT_RULES_MIGRATION,
  ];

  const failedMigrationNames = [];

  for (const migrationName of migrationNames) {
    const migration = await getMigrationRecord(migrationName);
    const isFailed =
      migration &&
      migration.finished_at == null &&
      migration.rolled_back_at == null;

    if (isFailed) {
      failedMigrationNames.push(migrationName);
    } else if (
      migrationName === PRICE_ADJUSTMENT_RULES_MIGRATION &&
      !migration &&
      priceAdjustmentRulesColumnReady
    ) {
      failedMigrationNames.push(migrationName);
    }
  }

  if (failedMigrationNames.length > 0) {
    await prisma.$disconnect();

    failedMigrationNames.forEach((migrationName) => {
      console.log(`[db-prepare] Resolving failed migration ${migrationName}`);
      resolveFailedMigration(migrationName);
    });
  }
} finally {
  await prisma.$disconnect().catch(() => {});
}
