import express from 'express';

const MODES = new Set(['commercial-light', 'commercial-dark', 'sepia']);

export default function storefrontModeRoutes({ getPartner, saveMode }) {
  const router = express.Router({ mergeParams: true });
  router.patch('/', async (req, res) => {
    const partnerId = Number(req.params.partnerId);
    const mode = req.body?.storefrontMode;
    if (!Number.isSafeInteger(partnerId) || partnerId < 1 || !MODES.has(mode)) {
      return res.status(400).json({ error: 'invalid_storefront_mode' });
    }
    try {
      if (!await getPartner(partnerId)) return res.status(404).json({ error: 'partner_not_found' });
      await saveMode(partnerId, mode);
      return res.json({ partnerId, storefrontMode: mode });
    } catch (error) {
      console.error('[storefront-mode]', error.code || error.name);
      return res.status(500).json({ error: 'storefront_mode_not_saved' });
    }
  });
  return router;
}
