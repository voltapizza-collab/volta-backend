// A POS ticket list does not need the backoffice's six-month analytics dataset.
export async function posDailySummary(prisma, { where, from, to, cursor, formatSale }) {
  const pageSize = 50;
  let after;
  if (cursor) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 300) throw new Error();
      after = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!Number.isSafeInteger(after.id) || after.id < 1 || !Number.isFinite(Date.parse(after.date)) || after.from !== from.toISOString()) throw new Error();
    } catch (_) { throw Object.assign(new Error('invalid_history_cursor'), { status: 400 }); }
  }
  const dailyWhere = { ...where, date: { gte: from, lt: to } };
  const [rows, totals] = await Promise.all([
    prisma.sale.findMany({
      where: after ? { AND: [dailyWhere, { OR: [{ date: { lt: new Date(after.date) } }, { date: new Date(after.date), id: { lt: after.id } }] }] } : dailyWhere,
      orderBy: [{ date: 'desc' }, { id: 'desc' }], take: pageSize + 1,
      include: { store: { select: { id: true, storeName: true, slug: true } }, partner: { select: { id: true, name: true, currency: true } } },
    }),
    prisma.sale.aggregate({ where: dailyWhere, _count: { _all: true }, _sum: { total: true } }),
  ]);
  const page = rows.slice(0, pageSize), last = page[page.length - 1];
  return { orders: page.map(formatSale), kpis: { ordersCount: totals._count._all, revenue: Number(totals._sum.total || 0) },
    nextCursor: rows.length > pageSize ? Buffer.from(JSON.stringify({ id: last.id, date: last.date, from: from.toISOString() })).toString('base64url') : null,
    from, to, updatedAt: new Date().toISOString() };
}
