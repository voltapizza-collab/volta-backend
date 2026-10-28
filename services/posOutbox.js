import { randomUUID } from 'node:crypto';
// Activate only after deploying the accompanying migration. Enqueue with the
// business mutation's transaction; no SMS or external I/O belongs in that transaction.
export const posOutboxEnabled = () => process.env.POS_OUTBOX_ENABLED === 'true';
export async function enqueuePosEffect(tx, kind, payload, id = randomUUID()) {
  await tx.$executeRawUnsafe('INSERT INTO PosEffectOutbox (id, kind, payload, state, createdAt, updatedAt) VALUES (?, ?, ?, ?, NOW(3), NOW(3))',
    id, kind, JSON.stringify(payload), 'PENDING');
  return id;
}
export async function saveIngredientWithEffects(prisma, { storeId, ingredientId, notify, active, saveStock }) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRawUnsafe('SELECT active FROM StoreIngredientStock WHERE storeId = ? AND ingredientId = ? FOR UPDATE', storeId, ingredientId);
    const updated = await saveStock(tx);
    const queued = notify && active !== undefined && !Boolean(active) && rows.length > 0 && Boolean(rows[0].active);
    if (queued) await enqueuePosEffect(tx, 'INGREDIENT_DISABLED', { storeId, ingredientId, occurredAt: new Date().toISOString() });
    return { updated, queued };
  });
}
export async function completeOrderWithEffects(prisma, id, readUpdated) {
  return prisma.$transaction(async tx => {
    const changed = await tx.sale.updateMany({ where: { id, processed: false, status: 'PAID' }, data: { processed: true } });
    if (!changed.count) throw Object.assign(new Error('Order already completed'), { status: 409 });
    await enqueuePosEffect(tx, 'ORDER_READY', { saleId: id }, `order-ready:${id}`);
    await enqueuePosEffect(tx, 'ORDER_REVIEW', { saleId: id }, `order-review:${id}`);
    return readUpdated(tx);
  });
}
export async function processPosOutbox(prisma, handlers, limit = 10) {
  // A process dying during an external send has an ambiguous outcome. Never
  // replay that SMS automatically (or charge credits again).
  await prisma.$executeRawUnsafe("UPDATE PosEffectOutbox SET state = 'REVIEW', error = 'worker_interrupted', updatedAt = NOW(3) WHERE state = 'PROCESSING' AND updatedAt < DATE_SUB(NOW(3), INTERVAL 10 MINUTE)");
  const jobs = await prisma.$queryRawUnsafe("SELECT id, kind, payload FROM PosEffectOutbox WHERE state = 'PENDING' ORDER BY createdAt, id LIMIT ?", Math.max(1, Math.min(limit, 20)));
  for (const job of jobs) {
    const claimed = await prisma.$executeRawUnsafe("UPDATE PosEffectOutbox SET state = 'PROCESSING', updatedAt = NOW(3) WHERE id = ? AND state = 'PENDING'", job.id);
    if (Number(claimed) !== 1) continue;
    try {
      const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      if (!handlers[job.kind]) throw new Error('unknown_effect');
      const result = await handlers[job.kind](payload);
      const state = result?.ok || result?.skipped ? 'DONE' : 'REVIEW';
      // Store only a bounded machine-readable reason, never recipients or message text.
      const reason = state === 'DONE' ? null : 'effect_not_confirmed';
      await prisma.$executeRawUnsafe('UPDATE PosEffectOutbox SET state = ?, error = ?, updatedAt = NOW(3) WHERE id = ? AND state = ?', state, reason, job.id, 'PROCESSING');
    } catch (_) {
      await prisma.$executeRawUnsafe("UPDATE PosEffectOutbox SET state = 'REVIEW', error = 'effect_not_confirmed', updatedAt = NOW(3) WHERE id = ? AND state = 'PROCESSING'", job.id);
    }
  }
  return jobs.length;
}
export function startPosOutboxWorker(prisma, handlers) {
  if (!posOutboxEnabled() || process.env.NODE_ENV === 'test') return null;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await processPosOutbox(prisma, handlers); }
    catch (_) { console.error('[pos-outbox] worker unavailable; durable jobs retained'); }
    finally { running = false; }
  };
  const timer = setInterval(run, 5000);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
