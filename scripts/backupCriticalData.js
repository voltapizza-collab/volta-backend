import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import prisma from "../services/prisma.js";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  })
);

const parsePositiveInt = (value, fallback = null) => {
  const number = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const parseBool = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
};

const backupDir = path.resolve(
  args.get("dir") ||
    process.env.VOLTA_BACKUP_DIR ||
    path.join(os.homedir(), "VoltaBackups", "critical-data")
);
const partnerId = parsePositiveInt(args.get("partner-id"), null);
const retentionDays = parsePositiveInt(
  args.get("retention-days") || process.env.VOLTA_BACKUP_RETENTION_DAYS,
  30
);
const retentionCount = parsePositiveInt(
  args.get("retention-count") || process.env.VOLTA_BACKUP_RETENTION_COUNT,
  60
);
const gzipOutput = parseBool(args.get("gzip") ?? process.env.VOLTA_BACKUP_GZIP, true);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const scope = partnerId ? `partner-${partnerId}` : "all-partners";
const baseName = `volta-critical-backup-${scope}-${timestamp}.json`;
const jsonPath = path.join(backupDir, baseName);
const outputPath = gzipOutput ? `${jsonPath}.gz` : jsonPath;
const checksumPath = `${outputPath}.sha256`;

const jsonReplacer = (_key, value) => {
  if (typeof value === "bigint") return value.toString();
  return value;
};

const writeFileAtomic = (filePath, content) => {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
};

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const findManySafe = async (modelName, options = {}) => {
  const model = prisma[modelName];
  if (!model?.findMany) {
    return { rows: [], skipped: true };
  }

  const rows = await model.findMany(options);
  return { rows, skipped: false };
};

const byId = { id: "asc" };
const byCreatedAt = [{ createdAt: "asc" }, { id: "asc" }];

async function buildBackupData() {
  const partnerWhere = partnerId ? { id: partnerId } : undefined;
  const partnerFilter = partnerId ? { partnerId } : undefined;

  const partners = await prisma.partner.findMany({
    where: partnerWhere,
    orderBy: byId,
  });

  if (partnerId && partners.length === 0) {
    throw new Error(`Partner ${partnerId} not found`);
  }

  const stores = await prisma.store.findMany({
    where: partnerFilter,
    orderBy: byId,
  });
  const storeIds = stores.map((store) => store.id);

  const menuPizzas = await prisma.menuPizza.findMany({
    where: partnerFilter,
    orderBy: byId,
  });
  const menuPizzaIds = menuPizzas.map((pizza) => pizza.id);

  const games = await prisma.game.findMany({
    where: partnerFilter,
    orderBy: byId,
  });
  const gameIds = games.map((game) => game.id);

  const tables = {
    partners,
    stores,
    customers: (
      await findManySafe("customer", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    sales: (
      await findManySafe("sale", {
        where: partnerFilter,
        orderBy: byCreatedAt,
      })
    ).rows,
    coupons: (
      await findManySafe("coupon", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    couponRedemptions: (
      await findManySafe("couponRedemption", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    smsCreditLedger: (
      await findManySafe("smsCreditLedger", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    reservations: (
      await findManySafe("reservation", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    productReviewRequests: (
      await findManySafe("productReviewRequest", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    productReviewVotes: (
      await findManySafe("productReviewVote", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    promos: (
      await findManySafe("promo", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    directDiscounts: (
      await findManySafe("directDiscount", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    incentives: (
      await findManySafe("incentive", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    games,
    gamePlays: (
      await findManySafe("gamePlay", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    menuPizzas,
    menuPizzaIngredients: (
      await findManySafe("menuPizzaIngredient", {
        where: menuPizzaIds.length ? { menuPizzaId: { in: menuPizzaIds } } : { menuPizzaId: -1 },
        orderBy: byId,
      })
    ).rows,
    ingredientExtras: (
      await findManySafe("ingredientExtra", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    ingredientCategoryUses: (
      await findManySafe("ingredientCategoryUse", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    partnerCategories: (
      await findManySafe("partnerCategory", {
        where: partnerFilter,
        orderBy: byId,
      })
    ).rows,
    storeHours: (
      await findManySafe("storeHours", {
        where: storeIds.length ? { storeId: { in: storeIds } } : { storeId: -1 },
        orderBy: byId,
      })
    ).rows,
    storePizzaStock: (
      await findManySafe("storePizzaStock", {
        where: storeIds.length ? { storeId: { in: storeIds } } : { storeId: -1 },
      })
    ).rows,
    storeIngredientStock: (
      await findManySafe("storeIngredientStock", {
        where: storeIds.length ? { storeId: { in: storeIds } } : { storeId: -1 },
      })
    ).rows,
    boostSettings: (
      await findManySafe("boostSetting", {
        orderBy: byId,
      })
    ).rows,
  };

  const counts = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : 0])
  );

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      backupVersion: 1,
      app: "volta-core",
      scope,
      partnerId,
      gzip: gzipOutput,
      retentionDays,
      retentionCount,
      nodeVersion: process.version,
    },
    counts,
    data: tables,
  };
}

const cleanupRetention = () => {
  const backupFiles = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith("volta-critical-backup-") && name.endsWith(".json.gz"))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      return {
        name,
        filePath,
        checksumPath: `${filePath}.sha256`,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  backupFiles.forEach((file, index) => {
    const expiredByCount = index >= retentionCount;
    const expiredByAge = now - file.mtimeMs > maxAgeMs;
    if (!expiredByCount && !expiredByAge) return;

    fs.unlinkSync(file.filePath);
    if (fs.existsSync(file.checksumPath)) fs.unlinkSync(file.checksumPath);
  });
};

async function main() {
  fs.mkdirSync(backupDir, { recursive: true });

  const backupData = await buildBackupData();
  const jsonBuffer = Buffer.from(JSON.stringify(backupData, jsonReplacer, 2), "utf8");
  const outputBuffer = gzipOutput ? gzipSync(jsonBuffer) : jsonBuffer;
  const checksum = sha256(outputBuffer);

  writeFileAtomic(outputPath, outputBuffer);
  writeFileAtomic(checksumPath, `${checksum}  ${path.basename(outputPath)}\n`);
  cleanupRetention();

  console.log(
    JSON.stringify(
      {
        ok: true,
        file: outputPath,
        checksumFile: checksumPath,
        sha256: checksum,
        bytes: outputBuffer.length,
        uncompressedBytes: jsonBuffer.length,
        counts: backupData.counts,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[backup-critical-data] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
