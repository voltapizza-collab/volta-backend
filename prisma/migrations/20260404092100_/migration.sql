-- 🔥 añadir columna con default (CLAVE)
ALTER TABLE Ingredient
ADD COLUMN allergens JSON NOT NULL DEFAULT ('[]');

-- opcional (pero ya lo dejamos listo)
ALTER TABLE Ingredient
ADD COLUMN calories FLOAT NULL,
ADD COLUMN protein FLOAT NULL,
ADD COLUMN carbs FLOAT NULL,
ADD COLUMN fat FLOAT NULL;

-- control sistema
ALTER TABLE Ingredient
ADD COLUMN isSystem BOOLEAN NOT NULL DEFAULT true;