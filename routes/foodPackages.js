import express from 'express';
import { foodError, parsePackageIds, snapshotPackages, applyFoodConfiguration, foodAssignmentPreview, sameFoodConfiguration } from '../services/foodPackages.js';

export default function foodPackagesRoutes(db) {
  const router = express.Router();
  const handle = fn => async (req, res) => { try { await fn(req, res); } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'food_configuration_failed' }); } };
  // These routes are intentionally global-admin-only, including the previews.
  router.use((req, res, next) => req.webSession?.role === 'global_admin' ? next() : res.status(403).json({ error: 'global_admin_required' }));
  router.get('/', handle(async (_req, res) => res.json(await db.foodPackage.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] }))));
  const save = handle(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const categoryIds = parsePackageIds(req.body.categoryIds);
    const position = Number(req.body.position ?? 0);
    if (!name || name.length > 120 || description.length > 1000 || !Number.isInteger(position) || position < 0 || position > 10000 || typeof req.body.active !== 'boolean') throw foodError('invalid_food_package');
    const categories = await db.category.findMany({ where: { id: { in: categoryIds } } });
    if (categories.length !== categoryIds.length || (req.body.active && !categoryIds.length)) throw foodError('food_package_categories_required');
    const data = { name, description, categoryIds, position, active: req.body.active };
    res.json(req.params.id ? await db.foodPackage.update({ where: { id: Number(req.params.id) }, data }) : await db.foodPackage.create({ data }));
  });
  router.post('/', save);
  router.patch('/:id', save);
  router.get('/partners/:id', handle(async (req, res) => {
    const partner = await db.partner.findUnique({ where: { id: Number(req.params.id) } });
    if (!partner) throw foodError('partner_not_found', 404);
    res.json({ configuration: partner.foodConfiguration || null });
  }));
  for (const action of ['preview', 'apply']) router.post(`/partners/:id/${action}`, handle(async (req, res) => {
    const result = await db.$transaction(async tx => {
      const id = Number(req.params.id);
      await tx.$queryRaw`SELECT id FROM Partner WHERE id = ${id} FOR UPDATE`;
      const partner = await tx.partner.findUnique({ where: { id } });
      if (!partner) throw foodError('partner_not_found', 404);
      if (!sameFoodConfiguration(req.body.expectedConfiguration, partner.foodConfiguration)) throw foodError('food_configuration_changed', 409);
      const config = await snapshotPackages(tx, req.body.packageIds, partner.foodConfiguration);
      const preview = await foodAssignmentPreview(tx, partner, config);
      if (action === 'apply') {
        if (!sameFoodConfiguration(req.body.previewConfiguration, config)) throw foodError('food_preview_changed', 409);
        return { ...preview, configuration: await applyFoodConfiguration(tx, partner, config) };
      }
      return { ...preview, configuration: config };
    });
    res.json(result);
  }));
  router.get('/requests/:id', handle(async (req, res) => {
    const request = await db.onboardingRequest.findUnique({ where: { id: Number(req.params.id) } });
    if (!request) throw foodError('onboarding_request_not_found', 404);
    res.json({ configuration: request.formalData?.onboardingDraft?.foodConfiguration || request.formalData?.foodConfiguration || null,
      editable: !['ACTIVATED', 'APPROVED', 'REJECTED'].includes(request.status) });
  }));
  router.post('/requests/:id/apply', handle(async (req, res) => {
    const result = await db.$transaction(async tx => {
      const id = Number(req.params.id);
      await tx.$queryRaw`SELECT id FROM OnboardingRequest WHERE id = ${id} FOR UPDATE`;
      const row = await tx.onboardingRequest.findUnique({ where: { id } });
      if (!row || ['ACTIVATED', 'APPROVED', 'REJECTED'].includes(row.status)) throw foodError('onboarding_request_closed', 409);
      const previous = row.formalData?.onboardingDraft?.foodConfiguration || row.formalData?.foodConfiguration || null;
      if (!sameFoodConfiguration(req.body.expectedConfiguration, previous)) throw foodError('food_configuration_changed', 409);
      const config = { ...await snapshotPackages(tx, req.body.packageIds, previous), updatedAt: new Date().toISOString(), updatedBy: 'global_admin' };
      const formalData = { ...row.formalData, foodConfiguration: config, foodPackageIds: config.packages.map(p => p.id) };
      if (formalData.onboardingDraft) formalData.onboardingDraft = { ...formalData.onboardingDraft, foodConfiguration: config, foodPackageIds: formalData.foodPackageIds };
      await tx.onboardingRequest.update({ where: { id }, data: { formalData } });
      return config;
    });
    res.json({ configuration: result });
  }));
  return router;
}
