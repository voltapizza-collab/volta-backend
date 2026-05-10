ALTER TABLE Category
  ADD COLUMN halfAndHalf BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE Category
SET halfAndHalf = TRUE
WHERE LOWER(name) IN ('pizza basica', 'pizza especial');
