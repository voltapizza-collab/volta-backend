-- Prices are configured explicitly by each business. No offer-derived backfill.
ALTER TABLE `PartnerCategory` ADD COLUMN `customBasePrices` JSON NULL;
