// Proposal only. Not imported by the application, seeds or deployment migrations.
// These rules produce a reviewable, fingerprinted per-identity manifest.
export const taxonomyVersion = 'restaurant-v2-proposal-2026-09-18';
export const categories = [
  ['CARNES_AVES', 'Carnes y aves', 'meats_poultry'],
  ['EMBUTIDOS_CHARCUTERIA', 'Embutidos y charcutería', 'cured_meats'],
  ['PESCADOS_Y_MARISCOS', 'Pescados y mariscos', 'seafood'],
  ['QUESOS', 'Quesos', 'cheeses'],
  ['LACTEOS_HUEVOS', 'Lácteos y huevos', 'dairy_eggs'],
  ['VERDURAS_SETAS_ALGAS', 'Verduras, setas y algas', 'vegetables_mushrooms_algae'],
  ['FRUTAS', 'Frutas', 'fruits'],
  ['LEGUMBRES_PROTEINAS_VEGETALES', 'Legumbres y proteínas vegetales', 'legumes_plant_proteins'],
  ['PASTAS_ARROCES_CEREALES', 'Pastas, arroces y cereales', 'pasta_rice_grains'],
  ['PANES_MASAS_HARINAS', 'Panes, masas y harinas', 'bread_dough_flour'],
  ['FRUTOS_SECOS_SEMILLAS', 'Frutos secos y semillas', 'nuts_seeds'],
  ['ACEITES_GRASAS_VINAGRES', 'Aceites, grasas y vinagres', 'oils_fats_vinegars'],
  ['SALSAS_CONDIMENTOS_BASES', 'Salsas, condimentos y bases de cocina', 'sauces_seasonings_bases'],
  ['REPOSTERIA_AUXILIARES', 'Repostería y auxiliares culinarios', 'baking_culinary_aids'],
].map(([key, name, suffix], position) => ({ key, name, semanticKey: `restaurant_v2_${suffix}`, position: (position + 1) * 10 }));

export const legacyDefaults = {
  CARNES: 'CARNES_AVES', EMBUTIDOS: 'EMBUTIDOS_CHARCUTERIA', PESCADOS_Y_MARISCOS: 'PESCADOS_Y_MARISCOS',
  QUESOS: 'QUESOS', VERDURAS: 'VERDURAS_SETAS_ALGAS', SETAS: 'VERDURAS_SETAS_ALGAS', FRUTAS: 'FRUTAS',
  ACEITES_GRASAS_VINAGRES: 'ACEITES_GRASAS_VINAGRES', SALSAS: 'SALSAS_CONDIMENTOS_BASES',
  HIERBAS_ESPECIAS: 'SALSAS_CONDIMENTOS_BASES', AROMAS_Y_EXTRACTOS: 'REPOSTERIA_AUXILIARES',
  CREMAS_DULCES: 'REPOSTERIA_AUXILIARES', ENDULZANTES: 'REPOSTERIA_AUXILIARES',
};

// All explicit overrides are identity-based. Never classify database rows by fuzzy names.
const groups = {
  LACTEOS_HUEVOS: `shubat clara_de_huevo clara_de_huevo_deshidratada huevo huevo_de_codorniz huevo_en_polvo
    huevo_entero_deshidratado huevo_frito huevo_milenario leche_desnatada_en_polvo leche_entera_en_polvo nata_doble
    salted_egg_huevo_de_pato_salado suero_de_leche_en_polvo yema_de_huevo yema_de_huevo_en_polvo
    leche_entera leche_de_cabra leche_de_oveja yogur_natural yogur_griego_natural suero_de_mantequilla_fermentado
    leche_de_bufala huevo_de_pato_fresco huevo_de_oca huevo_de_pava lactosuero_dulce_liquido lactosuero_acido_liquido
    suero_de_mantequilla_en_polvo proteina_concentrada_de_leche leche_condensada smetana_crema_agria
    crema_de_leche cr_me_fra_che kumis`,
  LEGUMBRES_PROTEINAS_VEGETALES: `at_n_vegano chorizo_vegetal falafel jackfruit_bbq jackfruit_estilo_pulled_pork
    jackfruit_pepperoni jam_n_vegano natto pepperoni_de_zanahoria pepperoni_vegetal pepperoni_vegetal_de_guisantes
    prote_na_de_garbanzo prote_na_de_guisante salami_vegano salchicha_italiana_vegetal seit_n seit_n_ahumado
    seit_n_estilo_shawarma soja_texturizada tempeh tempeh_ahumado tofu tofu_ahumado tofu_apestoso tofu_de_garbanzo_birmano
    altramuz alubias_blancas alubias_cannellini alubias_rojas copos_de_soja frijoles_negros_fermentados garbanzo
    guisantes_de_ojo_negro lentejas lentejas_rojas judias_azuki frijoles_negros alubias_pintas judias_mungo
    guisantes_partidos habas_secas judiones_de_lima_secos gandules_secos judias_moth judias_urd judias_jacinto
    alubias_rosadas alubias_amarillas alubias_great_northern alubias_navy proteina_aislada_de_soja
    edamame guisantes habas_tiernas`,
  VERDURAS_SETAS_ALGAS: `algas_nori algas_wakame copos_de_patata ensalada_de_col jengibre_encurtido leche_de_patata
    pur_de_cebolla pur_de_coliflor pur_de_jengibre pur_de_patata trufa_de_mar kombu_de_azucar ascofilo
    alga_dulse espagueti_de_mar espirulina ogonori chlorella uva_de_mar pur_de_calabaza`,
  FRUTAS: `coco_rallado coco_rallado_tostado copos_de_coco jugo_de_pasas leche_de_coco piel_de_naranja_confitada
    pur_de_ciruela_dulce pur_de_lima ralladura_de_lim_n agua_de_coco crema_de_coco bocadillo_de_guayaba mantequilla_de_manzana`,
  PASTAS_ARROCES_CEREALES: `arroz arroz_integral_germinado avena couscous fideos_de_arroz popcorn_palomitas_de_ma_z
    semilla_de_mijo semillas_de_quinoa_roja shiratama tteok quinoa amaranto_en_grano trigo_sarraceno bulgur cebada_perlada
    centeno_en_grano sorgo_en_grano teff_en_grano arroz_salvaje salvado_de_avena perlas_de_tapioca germen_de_trigo
    salvado_de_trigo salvado_de_arroz salvado_de_maiz cebada_mondada triticale_en_grano trigo_duro_en_grano trigo_khorasan
    espelta_en_grano trigo_sarraceno_tostado arroz_integral arroz_glutinoso arroz_vaporizado pasta_seca_de_trigo
    pasta_integral_de_trigo pasta_de_maiz fideos_soba fideos_somen fideos_al_huevo pasta_fresca_de_trigo pasta_fresca_de_espinaca ma_z_tostado`,
  PANES_MASAS_HARINAS: `casabe fain_tortilla_de_garbanzos f_cula_de_mandioca f_cula_de_ma_z injera pan_de_pita pan_rallado panko
    papadum_triturado rusk harina_de_arroz harina_de_arroz_integral harina_de_garbanzo harina_de_trigo_sarraceno
    harina_de_centeno_oscura harina_de_avena harina_de_cebada harina_de_mijo harina_integral_de_sorgo harina_de_soja
    harina_de_trigo harina_integral_de_trigo harina_de_fuerza harina_de_trigo_con_levadura_quimica semola_de_trigo
    gluten_vital_de_trigo harina_de_maiz harina_de_maiz_azul harina_de_maiz_nixtamalizado semola_de_maiz harina_de_triticale
    harina_de_malta_de_cebada harina_de_arrurruz harina_de_algarroba harina_de_sesamo_parcialmente_desgrasada
    harina_de_semillas_de_girasol harina_de_cacahuete harina_de_bellota almidon_de_arroz_glutinoso`,
  FRUTOS_SECOS_SEMILLAS: `almendra anacardos avellana avellanas_tostadas cacahuete_man linaza_dorada linaza_molida nuez
    nuez_de_macadamia pecana pistacho pistacho_de_antep pi_ones semillas_de_acacias_tostadas_wattleseed semillas_de_amapola
    semillas_de_calabaza semillas_de_ch_a semillas_de_girasol semillas_de_lino semillas_de_lino_integral semillas_de_s_samo
    s_samo_tostado nueces_de_brasil castana_europea semillas_de_canamo_peladas semillas_de_loto_secas crema_de_semillas_de_girasol
    crema_pura_de_anacardo nuez_negra nueces_de_pili castanas_secas_peladas semillas_de_loto_frescas semillas_de_sandia
    castana_japonesa castana_china nuez_de_hickory nuez_cenicienta semillas_de_cartamo semillas_de_ramon tahini`,
  SALSAS_CONDIMENTOS_BASES: `chile_crispy concentrado_de_champi_ones concentrado_de_remolacha concentrado_de_tomate
    marsala oporto_rojo sal_de_camargue sal_de_gu_rande semillas_de_alcaravea semillas_de_comino semillas_de_hinojo
    semillas_de_mostaza vegemite sal_de_mesa vinagreta_brasile_a salsa_mascarpone mango_chutney
    aroma_de_setas extracto_de_ajo extracto_de_cebolla extracto_de_chile extracto_de_jengibre extracto_de_lev_stico
    extracto_de_oregano extracto_de_piment_n extracto_de_pimienta_blanca extracto_de_romero extracto_de_tomillo
    humo_de_madera_de_haya humo_natural aroma_de_trufa_blanca aroma_de_trufa_negra cebollino shiso_perilla`,
  REPOSTERIA_AUXILIARES: `cacao_sin_az_car fibra_de_achicoria fibra_de_bamb fibra_de_lino fibra_de_trigo gelatina gelatina_de_cerdo
    psyllium cuajo_de_oveja levadura_fresca_de_panaderia levadura_seca_de_panaderia bicarbonato_sodico_alimentario cremor_tartaro
    lecitina_de_soja glicerina_alimentaria goma_arabiga goma_garrofin goma_tara goma_guar goma_xantana agar_agar goma_gellan
    alginato_de_sodio gelatina_bovina maltodextrina acido_tartarico_alimentario acido_ascorbico_alimentario acido_citrico_alimentario`,
  ACEITES_GRASAS_VINAGRES: 'manteca_de_cacao',
  EMBUTIDOS_CHARCUTERIA: 'biltong cecina lardons spam',
};

export const overrides = new Map();
for (const [category, words] of Object.entries(groups)) {
  for (const key of words.trim().split(/\s+/)) {
    if (overrides.has(key)) throw new Error(`Duplicate taxonomy decision: ${key}`);
    overrides.set(key, { category, reason: 'Clasificación explícita por identidad y forma culinaria.' });
  }
}

export const reviewRequired = new Map([
  ['caracoles_malteses', 'Las 14 etiquetas propuestas no explicitan moluscos terrestres; decidir dónde ubicarlos sin presentarlos como marisco.'],
  ['escargots_de_bourgogne', 'Las 14 etiquetas propuestas no explicitan moluscos terrestres; decidir dónde ubicarlos sin presentarlos como marisco.'],
  ['cigarras', 'Las 14 etiquetas propuestas no cubren claramente insectos culinarios; resolver el alcance antes de migrar.'],
  ['gusanos_mopani', 'Las 14 etiquetas propuestas no cubren claramente insectos culinarios; resolver el alcance antes de migrar.'],
  ['tempura', 'Confirmar si la ficha representa mezcla de rebozado o un alimento ya rebozado.'],
  ['crema_de_avellanas', 'Confirmar si es pasta pura de fruto seco o crema dulce formulada.'],
  ['crema_de_cacahuete', 'Confirmar si es pasta pura de fruto seco o crema dulce formulada.'],
  ['crema_de_pistacho', 'Confirmar si es pasta pura de fruto seco o crema dulce formulada.'],
]);

export function decisionFor(row) {
  if (row.restaurantCategoryKey) {
    if (!categories.some(category => category.key === row.restaurantCategoryKey)) throw new Error(`Unknown restaurant family for ${row.canonicalKey}`);
    return { category: row.restaurantCategoryKey, status: 'PROPOSED', rule: 'reviewed_expansion_identity', reason: 'Familia revisada por identidad en el lote de ampliación; conserva la categoría histórica.' };
  }
  if (reviewRequired.has(row.canonicalKey)) return { category: null, status: 'REVIEW_REQUIRED', reason: reviewRequired.get(row.canonicalKey) };
  if (overrides.has(row.canonicalKey)) return { ...overrides.get(row.canonicalKey), status: 'PROPOSED', rule: 'identity' };
  // A documented batch of named bean varieties in Otros. The generated manifest fixes every identity explicitly.
  if (row.category === 'OTROS' && row.canonicalKey.startsWith('alubia_')) {
    return { category: 'LEGUMBRES_PROTEINAS_VEGETALES', status: 'PROPOSED', rule: 'named_bean_variety', reason: 'Variedad identificada de alubia.' };
  }
  if (legacyDefaults[row.category]) return { category: legacyDefaults[row.category], status: 'PROPOSED', rule: 'legacy_family', reason: 'Continuidad de la familia existente; no implica revisión de composición o alérgenos.' };
  return { category: null, status: 'REVIEW_REQUIRED', reason: 'No existe una decisión de clasificación explícita.' };
}
