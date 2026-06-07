import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  SMS_PRICING_RESET_REFERENCE,
  SMS_PROVIDER_COST_EUR,
  SMS_SELL_PRICE_EUR,
  getSmsCreditPackages,
} from "../services/smsCredits.js";

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

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const resetReference = SMS_PRICING_RESET_REFERENCE;
const prisma = new PrismaClient();

const formatPackages = () =>
  getSmsCreditPackages()
    .map((item) => `${item.amount} EUR=${item.credits}`)
    .join(", ");

async function main() {
  const partners = await prisma.partner.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      smsCredits: true,
      smsRecharged: true,
      smsConsumed: true,
    },
  });

  const affectedPartners = partners.filter(
    (partner) => partner.smsCredits || partner.smsRecharged || partner.smsConsumed
  );
  const totals = affectedPartners.reduce(
    (summary, partner) => ({
      credits: summary.credits + partner.smsCredits,
      recharged: summary.recharged + partner.smsRecharged,
      consumed: summary.consumed + partner.smsConsumed,
    }),
    { credits: 0, recharged: 0, consumed: 0 }
  );

  console.log("[sms-reconcile] Pricing after audit");
  console.log(`[sms-reconcile] Sell price: EUR ${SMS_SELL_PRICE_EUR} per SMS_1_PART`);
  console.log(`[sms-reconcile] Provider cost: EUR ${SMS_PROVIDER_COST_EUR} per SMS_1_PART`);
  console.log(`[sms-reconcile] Packages: ${formatPackages()}`);
  console.log("[sms-reconcile] Current non-zero partner balances");

  if (!affectedPartners.length) {
    console.log("[sms-reconcile] Nothing to reset.");
    return;
  }

  affectedPartners.forEach((partner) => {
    console.log(
      `[sms-reconcile] ${partner.id} ${partner.name}: available=${partner.smsCredits}, sold=${partner.smsRecharged}, consumed=${partner.smsConsumed}`
    );
  });

  console.log(
    `[sms-reconcile] Totals: available=${totals.credits}, sold=${totals.recharged}, consumed=${totals.consumed}`
  );

  if (!apply) {
    console.log("[sms-reconcile] Dry run only. Re-run with --apply to reset these counters to zero.");
    return;
  }

  const existingReset = await prisma.smsCreditLedger.findFirst({
    where: { reference: resetReference, type: "ADJUSTMENT" },
    select: { id: true },
  });

  if (existingReset) {
    console.log(`[sms-reconcile] Reset already applied (${resetReference}). No changes made.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const partner of affectedPartners) {
      await tx.partner.update({
        where: { id: partner.id },
        data: {
          smsCredits: 0,
          smsRecharged: 0,
          smsConsumed: 0,
        },
      });

      await tx.smsCreditLedger.create({
        data: {
          partnerId: partner.id,
          type: "ADJUSTMENT",
          quantity: -partner.smsCredits,
          balanceAfter: 0,
          unitPrice: SMS_SELL_PRICE_EUR,
          providerCost: SMS_PROVIDER_COST_EUR,
          provider: "telnyx",
          reference: resetReference,
          note: "SMS pricing audit reset: old credits were generated with invalid 0.0004/0.0008 pricing.",
          meta: {
            source: "sms_pricing_audit",
            oldSmsCredits: partner.smsCredits,
            oldSmsRecharged: partner.smsRecharged,
            oldSmsConsumed: partner.smsConsumed,
            newSmsCredits: 0,
            newSmsRecharged: 0,
            newSmsConsumed: 0,
            sellPriceEur: SMS_SELL_PRICE_EUR,
            providerCostEur: SMS_PROVIDER_COST_EUR,
          },
        },
      });
    }
  });

  console.log(`[sms-reconcile] Applied reset ${resetReference}.`);
  console.log("[sms-reconcile] All affected partner SMS counters are now zero.");
}

main()
  .catch((error) => {
    console.error("[sms-reconcile] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
