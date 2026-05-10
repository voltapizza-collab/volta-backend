const DEFAULT_UNIT_PRICE = Number(process.env.BOOST_PRICE_PER_POSITION || 0.2);
const DEFAULT_MAX_OPTIONS = Number(process.env.BOOST_MAX_OPTIONS || 3);
const DEFAULT_VOLTA_SHARE_PERCENT = Number(process.env.BOOST_VOLTA_SHARE_PERCENT || 25);

const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toPercent = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : fallback;
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const normalizeBoostSettings = (settings = {}) => {
  const unitPrice = toPositiveNumber(settings.unitPrice, DEFAULT_UNIT_PRICE || 0.2);
  const maxOptions = toPositiveInt(settings.maxOptions, DEFAULT_MAX_OPTIONS || 3);
  const voltaSharePercent = toPercent(
    settings.voltaSharePercent,
    DEFAULT_VOLTA_SHARE_PERCENT || 25
  );
  const partnerSharePercent = Math.max(0, 100 - voltaSharePercent);

  return {
    id: 1,
    active: settings.active !== false,
    unitPrice,
    maxOptions,
    voltaSharePercent,
    partnerSharePercent,
  };
};

export const getBoostSettings = async (prisma) => {
  const existing = await prisma.boostSetting.findUnique({
    where: { id: 1 },
  });

  if (existing) return normalizeBoostSettings(existing);

  const created = await prisma.boostSetting.create({
    data: normalizeBoostSettings(),
  });

  return normalizeBoostSettings(created);
};
