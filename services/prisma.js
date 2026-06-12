import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const requestMetrics = new AsyncLocalStorage();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, "..", ".env");

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

const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const slowQueryMs = toPositiveNumber(process.env.SLOW_QUERY_MS, 300);
const slowRequestMs = toPositiveNumber(process.env.SLOW_REQUEST_MS, 800);
const noisyQueryCount = toPositiveNumber(process.env.NOISY_QUERY_COUNT, 20);

const isPrismaConnectionClosed = (error) =>
  error?.code === "P1017" ||
  String(error?.message || "").includes("Server has closed the connection");

export const prisma = new PrismaClient();

const recordQuery = (params, durationMs) => {
  const context = requestMetrics.getStore();

  if (context) {
    context.queryCount += 1;
    context.queryMs += durationMs;

    if (durationMs >= slowQueryMs) {
      context.slowQueries.push({
        model: params.model || "raw",
        action: params.action,
        durationMs: Math.round(durationMs),
      });
    }
  }

  if (durationMs >= slowQueryMs) {
    console.warn(
      `[db.slow] ${params.model || "raw"}.${params.action} ${Math.round(durationMs)}ms`
    );
  }
};

prisma.$use(async (params, next) => {
  const startedAt = performance.now();

  try {
    const result = await next(params);
    recordQuery(params, performance.now() - startedAt);
    return result;
  } catch (error) {
    if (!isPrismaConnectionClosed(error)) {
      recordQuery(params, performance.now() - startedAt);
      throw error;
    }

    console.warn("[prisma] connection closed; reconnecting and retrying once");
    await prisma.$disconnect().catch(() => {});
    await prisma.$connect();

    const retryStartedAt = performance.now();
    const result = await next(params);
    recordQuery(params, performance.now() - retryStartedAt);
    return result;
  }
});

export const withRequestMetrics = (req, res, next) => {
  const startedAt = performance.now();
  const context = {
    queryCount: 0,
    queryMs: 0,
    slowQueries: [],
  };

  requestMetrics.run(context, () => {
    res.on("finish", () => {
      const durationMs = performance.now() - startedAt;
      const shouldLog =
        durationMs >= slowRequestMs ||
        context.queryCount >= noisyQueryCount ||
        context.slowQueries.length > 0;

      if (!shouldLog) return;

      const slowQueryLabel = context.slowQueries
        .slice(0, 4)
        .map((query) => `${query.model}.${query.action}:${query.durationMs}ms`)
        .join(",");

      console.warn(
        [
          `[http.slow] ${req.method} ${req.originalUrl}`,
          `${res.statusCode}`,
          `${Math.round(durationMs)}ms`,
          `queries=${context.queryCount}`,
          `db=${Math.round(context.queryMs)}ms`,
          slowQueryLabel ? `slow=${slowQueryLabel}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    });

    next();
  });
};

export default prisma;
