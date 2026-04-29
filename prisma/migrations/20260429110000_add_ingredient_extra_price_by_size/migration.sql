ALTER TABLE `IngredientExtra`
  ADD COLUMN `priceBySize` JSON NULL;

UPDATE `IngredientExtra`
SET `priceBySize` = JSON_OBJECT(
  'S', `price`,
  'M', `price`,
  'L', `price`,
  'XL', `price`,
  'XXL', `price`,
  'ST', `price`
)
WHERE `priceBySize` IS NULL;
