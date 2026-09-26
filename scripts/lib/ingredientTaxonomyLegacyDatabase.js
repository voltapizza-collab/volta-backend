// Classification-only decisions reviewed against the isolated snapshot on 18 September 2026.
// These are NOT identity redirects. English canonical keys, IDs, names and duplicates remain intact.
const groups = [
  ['EMBUTIDOS', 'EMBUTIDOS_CHARCUTERIA', 'cooked_ham serrano_ham mortadella salami smoked_bacon smoked_chorizo spanish_chorizo spicy_chorizo'],
  ['CARNES', 'EMBUTIDOS_CHARCUTERIA', 'italian_sausage'],
  ['CARNES', 'CARNES_AVES', 'chicken chicken_wings ground_pork chicken_strips beef smoked_beef minced_beef shredded_beef'],
  ['SETAS', 'VERDURAS_SETAS_ALGAS', 'button_mushrooms truffle black_truffle white_button_mushrooms'],
  ['QUESOS', 'QUESOS', 'parmesan blue_cheese goat_cheese melted_cheddar aged_goat_cheese smoked_provolone arzua_cheese cream_cheese'],
  ['PESCADOS_Y_MARISCOS', 'PESCADOS_Y_MARISCOS', 'octopus anchovies tuna shrimp crab salmon cod'],
  ['FRUTAS', 'FRUTAS', 'figs apple pear pineapple blueberries caramelized_pineapple'],
  ['SALSAS', 'SALSAS_CONDIMENTOS_BASES', 'garlic_sauce honey_mustard_sauce hot_sauce bbq_sauce asparagus_sauce pesto_sauce tomato_sauce blueberry_sauce'],
  ['ACEITES_GRASAS_VINAGRES', 'ACEITES_GRASAS_VINAGRES', 'olive_oil chili_oil garlic_oil corn_oil balsamic_vinegar sherry_vinegar'],
  ['VERDURAS', 'VERDURAS_SETAS_ALGAS', 'black_olives green_olives artichoke zucchini onion red_bell_pepper green_bell_pepper caramelized_onion roasted_pumpkin eggplant red_onion cherry_tomatoes fresh_tomato sweet_corn jalapeno'],
  ['ENDULZANTES', 'REPOSTERIA_AUXILIARES', 'honey caramelized_sugar powdered_sugar'],
  ['CREMAS_DULCES', 'REPOSTERIA_AUXILIARES', 'milk_chocolate biscoff_spread pastry_cream'],
  ['CREMAS_DULCES', 'LACTEOS_HUEVOS', 'condensed_milk'],
  ['AROMAS_Y_EXTRACTOS', 'SALSAS_CONDIMENTOS_BASES', 'oregano_extract pimenton_extract white_pepper_extract'],
  ['HIERBAS_ESPECIAS', 'SALSAS_CONDIMENTOS_BASES', 'garlic_powder white_pepper'],
  ['OTROS', 'PANES_MASAS_HARINAS', 'nachos'],
];
export const legacyDatabaseClassifications = new Map();
for (const [from, to, keys] of groups) for (const key of keys.split(' ')) {
  if (legacyDatabaseClassifications.has(key)) throw new Error(`Duplicate database classification: ${key}`);
  legacyDatabaseClassifications.set(key, { from, to });
}
export const legacyDatabaseReviews = new Map([
  ['turkey', 'La ficha Pavo está en Embutidos; confirmar si es fiambre o carne de ave.'],
  ['white_hazelnut_cream', 'Confirmar composición de Avellana blanca antes de asignar fruto seco o preparación dulce.'],
  ['hazelnut_cream', 'Confirmar composición de Avellana tradicional antes de asignar fruto seco o preparación dulce.'],
  ['pistachio_cream', 'La ficha Pistacho está en Cremas dulces; confirmar si es crema formulada o pasta pura.'],
  ['coconut_cream', 'La ficha Crema de coco está en Cremas dulces; confirmar si es preparación azucarada o crema de coco sin endulzar.'],
]);
export const operationalKeys = new Set(['random_selection_1', 'random_selection_2', 'random_selection_3']);
