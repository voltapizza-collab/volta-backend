import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import storefrontModeRoutes from '../routes/storefrontMode.js';
import { authorizeBackoffice } from '../services/webAccess.js';

test('mode endpoint validates and persists only the mode, preserving other restaurant settings', async t => {
  const partner = { id: 7, storefrontMode: 'commercial-light', brandPrimary: '#123456', storefrontButtonConfig: { customPizza: false } };
  const app = express(); app.use(express.json());
  app.use('/partners/:partnerId/storefront-mode', storefrontModeRoutes({
    getPartner: async id => id === 7 ? partner : null,
    saveMode: async (id, mode) => { assert.equal(id, 7); partner.storefrontMode = mode; },
  }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const patch = (id, mode) => fetch(`http://127.0.0.1:${server.address().port}/partners/${id}/storefront-mode`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storefrontMode: mode, brandPrimary: '#ffffff', storefrontButtonConfig: {} }),
  });
  for (const mode of ['commercial-dark', 'commercial-light', 'sepia']) {
    assert.equal((await patch(7, mode)).status, 200);
    assert.equal(partner.storefrontMode, mode);
    assert.equal(partner.brandPrimary, '#123456');
    assert.equal(partner.storefrontButtonConfig.customPizza, false);
  }
  for (const mode of ['clean', 'volta', '', null, {}, true]) assert.equal((await patch(7, mode)).status, 400);
  assert.equal((await patch(8, 'commercial-dark')).status, 404);
});

test('backoffice may change only its own restaurant mode', async () => {
  const request = { method: 'PATCH', webSession: { role: 'backoffice', partnerId: 7 }, body: { storefrontMode: 'commercial-dark' }, query: {} };
  await authorizeBackoffice({}, request, '/partners/by-id/7/storefront-mode');
  await assert.rejects(authorizeBackoffice({}, request, '/partners/by-id/8/storefront-mode'), error => error.status === 403);
});
