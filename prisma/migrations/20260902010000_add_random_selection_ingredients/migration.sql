INSERT INTO `Ingredient` (
  `name`,
  `category`,
  `allergens`,
  `isSystem`,
  `stock`,
  `unit`,
  `costPrice`,
  `description`,
  `canonicalKey`,
  `semanticStatus`,
  `status`,
  `createdAt`,
  `updatedAt`
)
VALUES
  (
    'Random selection 1',
    'Random selection',
    JSON_ARRAY(),
    true,
    0,
    'selection',
    0.01,
    'Placeholder for one operator-selected surplus ingredient.',
    'random_selection_1',
    'REVIEWED',
    'ACTIVE',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  ),
  (
    'Random selection 2',
    'Random selection',
    JSON_ARRAY(),
    true,
    0,
    'selection',
    0.01,
    'Placeholder for two operator-selected surplus ingredients.',
    'random_selection_2',
    'REVIEWED',
    'ACTIVE',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  ),
  (
    'Random selection 3',
    'Random selection',
    JSON_ARRAY(),
    true,
    0,
    'selection',
    0.01,
    'Placeholder for three operator-selected surplus ingredients.',
    'random_selection_3',
    'REVIEWED',
    'ACTIVE',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  )
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `category` = VALUES(`category`),
  `allergens` = VALUES(`allergens`),
  `isSystem` = VALUES(`isSystem`),
  `unit` = VALUES(`unit`),
  `costPrice` = VALUES(`costPrice`),
  `description` = VALUES(`description`),
  `semanticStatus` = VALUES(`semanticStatus`),
  `status` = VALUES(`status`),
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `StoreIngredientStock` (
  `storeId`,
  `ingredientId`,
  `stock`,
  `active`,
  `createdAt`,
  `updatedAt`
)
SELECT
  s.`id`,
  i.`id`,
  0,
  true,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `Store` s
CROSS JOIN `Ingredient` i
WHERE i.`canonicalKey` IN (
  'random_selection_1',
  'random_selection_2',
  'random_selection_3'
);

UPDATE `StoreIngredientStock` sis
INNER JOIN `Ingredient` i
  ON i.`id` = sis.`ingredientId`
SET sis.`active` = true,
    sis.`updatedAt` = CURRENT_TIMESTAMP(3)
WHERE i.`canonicalKey` IN (
  'random_selection_1',
  'random_selection_2',
  'random_selection_3'
);
