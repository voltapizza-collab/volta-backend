// Presentation only. Keep sale.code intact for public tracking and integrations.
// Matches storefront/src/pos/orderDisplayCode.js; parity is covered by tests.
export function getOrderDisplayCode(order) {
  const code = String(order?.code || '');
  const id = Number(order?.id);
  if (/^WEB-[A-F0-9]{32}$/i.test(code) && Number.isSafeInteger(id) && id > 0) {
    return `WEB-${id}`;
  }
  return code || String(order?.id || '-');
}
