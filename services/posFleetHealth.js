export async function posFleetHealth(prisma, now = Date.now()) {
  const groups = new Map();
  let cursor, total = 0;
  do {
    const rows = await prisma.posDevice.findMany({ where: { status: 'AUTHORIZED' }, select: { id: true, softwareStatus: true },
      orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const device of rows) {
      const status = device.softwareStatus;
      const age = status?.lastReportAt ? now - new Date(status.lastReportAt).getTime() : Infinity;
      const freshness = age <= 15 * 60000 ? 'recent' : 'stale_or_offline';
      const key = JSON.stringify([status?.versionCode ?? null, status?.state || 'unknown', status?.error || null, freshness]);
      const group = groups.get(key) || { versionCode: status?.versionCode ?? null, state: status?.state || 'unknown', error: status?.error || null, freshness, count: 0 };
      group.count++; groups.set(key, group); total++;
    }
    cursor = rows.length === 100 ? rows[rows.length - 1].id : null;
  } while (cursor);
  return { observedAt: new Date(now).toISOString(), total, groups: [...groups.values()] };
}
