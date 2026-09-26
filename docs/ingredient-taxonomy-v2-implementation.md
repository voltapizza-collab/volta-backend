# Organización de ingredientes para restaurantes

18 de septiembre de 2026. Implementación local, pendiente de publicación coordinada.

**Auditoría posterior:** el recorrido operativo del POS y la conservación de datos se comprobaron, pero se reprodujeron dos problemas previos de disponibilidad en caché y checkout. Véase [informe de auditoría del 18 de septiembre](ingredient-taxonomy-v2-audit-2026-09-18.md) antes de considerar cerrada o publicar la entrega.

## Estrategia

La aplicación muestra una clasificación adicional de 14 familias. No se ejecuta la migración de columnas ensayada anteriormente. Se conservan `Ingredient.category`, `semanticCategoryId`, las identidades y el catálogo maestro original; las respuestas añaden `taxonomy` y mantienen los campos existentes. El algoritmo de asociación semántica y sus textos de búsqueda conservan su comportamiento. El inventario mantiene las agrupaciones anteriores para calcular sugerencias de coste.

La clasificación se aplica al catálogo global, al selector de la lista maestra, al inventario del backoffice, al inventario del TPV web y al selector de ingredientes para personalizar pedidos. Los nombres de las familias están disponibles en ES, EN, IT, FR, PT, AR y ZH; cada pantalla conserva su selector de idioma actual. No se ha generado ni distribuido un nuevo paquete nativo del TPV.

La ficha de edición muestra la categoría como dato de solo lectura, siguiendo la lista maestra. El guardado y la restauración envían `preserveClassification: true`: el backend conserva la categoría y el identificador semántico que encuentre dentro de la transacción. Nombres, idiomas, estado y fotos siguen editándose. Una reclasificación manual se revisa en el registro central; no se simula con un selector que solamente cambiaría el campo antiguo. Los clientes anteriores conservan su comportamiento de edición.

## Reparto de las 3.014 identidades

| Familia | Ingredientes |
| --- | ---: |
| Carnes, aves y otras proteínas animales | 127 |
| Embutidos y charcutería | 132 |
| Pescados y mariscos | 856 |
| Quesos | 438 |
| Lácteos y huevos | 35 |
| Verduras, setas y algas | 368 |
| Frutas | 287 |
| Legumbres y proteínas vegetales | 108 |
| Pastas, arroces y cereales | 43 |
| Panes, masas y harinas | 40 |
| Frutos secos y semillas | 40 |
| Aceites, grasas y vinagres | 77 |
| Salsas, condimentos y bases de cocina | 295 |
| Repostería y auxiliares culinarios | 168 |

No se han añadido ingredientes nuevos. Las entradas operativas de selección aleatoria se muestran separadas como «Selecciones especiales» y no cuentan como familia alimentaria. Las fichas sin identidad suficiente ni categoría aprovechable aparecen en «Sin clasificar».

## Clasificaciones pendientes

Cuatro fichas maestras conservan clasificación provisional: tempura y las cremas de avellanas, cacahuete y pistacho. La composición concreta determina si corresponde otra familia. Caracoles e insectos caben en la familia ampliada de proteínas animales; esto no añade afirmaciones sobre composición, alérgenos o disponibilidad comercial.

En la copia actual hay nueve fichas globales con revisión pendiente: Pavo (`turkey`, ID 25), cuatro cremas históricas (57, 58, 61, 62), Maíz (47), Extracto de paprika (75) y dos fichas independientes de relleno de mozzarella (54, 126). Se mantiene cada ID y su agrupación histórica más próxima. Pavo permanece en Embutidos y charcutería hasta confirmar si es fiambre o carne. No se fusionan las dos fichas de relleno ni se asignan equivalencias por similitud de nombre.

## Generación y comprobaciones

`node scripts/buildIngredientTaxonomy.js` produce `data/ingredientTaxonomy.json` y copia el mismo manifiesto y módulo ESM al storefront. Las reglas históricas inglesas solamente clasifican; no crean alias de identidad. Los ingredientes locales no heredan clasificaciones por coincidencias con claves globales. El campo protegido `masterCanonicalKey` viaja también en las respuestas de inventario y personalización.

El validador del storefront comprueba la huella del maestro, la cobertura completa, las 14 familias, sus siete traducciones y la igualdad de los dos manifiestos y módulos compartidos. El formato ESM es necesario: el empaquetador del storefront trata archivos `.cjs` fuera de sus reglas como recursos y no como código ejecutable.

Pruebas de backend: clasificación completa, claves retiradas, ingredientes locales, operaciones especiales, datos ambiguos, compatibilidad semántica, conservación de campos al editar y nota aún no publicada. Pruebas de interfaz: filtros de panes y pastas, alta con la categoría histórica, edición con categoría de solo lectura, conservación de idiomas y diálogos de inventario.

Compilación de producción correcta. Revisión con el navegador contra una API local conectada exclusivamente a la copia: catálogo de 131 fichas, selector de 3.014 opciones y 14 familias, filtro de 40 panes/masas/harinas y búsqueda de arroz dentro de pastas/cereales. Comprobado a 1.280, 390 y 320 px; sin desbordamiento horizontal en las vistas revisadas. En 320 px se abrió Pavo, se vio su aviso de revisión y se conservaron sus siete nombres en el editor. La vista de prueba bloquea escrituras y conexiones externas; las imágenes remotas no se validaron en esta revisión.

La comprobación `scripts/verifyIngredientTaxonomyProjection.js` solo admite `TAXONOMY_REHEARSAL_DATABASE_URL` apuntando a localhost y a la base dedicada `ingredient_taxonomy_rehearsal`. Realiza 30 consultas HTTP a los controladores reales y compara las 43 tablas antes y después. Resultado: idénticas, incluidos 135 ingredientes, 172 relaciones de recetas, 209 existencias por tienda y 104 configuraciones por categoría. Véase `ingredient-taxonomy-v2-projection-verification.json`.

Se usó un cliente Prisma generado aparte para la prueba porque otro proceso local mantenía bloqueada la biblioteca del cliente habitual. La base de origen no recibió escrituras. Se corrigió la detección de tablas semánticas para admitir los nombres en minúsculas de MySQL en Windows.

## Publicación y reversión

1. Publicar el backend compatible y el storefront correspondiente. Generar Prisma con el esquema existente durante el despliegue; esta reorganización no añade migraciones SQL. Conservar una versión anterior de ambas aplicaciones.
2. Comprobar en el entorno publicado catálogo, inventario y personalización, incluidos precios y selecciones existentes. Actualizar el paquete nativo por su procedimiento habitual cuando corresponda.
3. Incorporar `ingredientRestaurantTaxonomyAnnouncementDraft` a `backofficeAnnouncements`, fijar fechas reales de publicación y caducidad y ejecutar las pruebas de avisos. El borrador ES/EN/IT/FR/PT está fuera del feed para evitar anunciar una función antes de publicarla.
4. Para revertir esta organización visual basta volver al código anterior. No hay reclasificación masiva de datos que deshacer. Las nuevas solicitudes que utilicen códigos de familia nuevos deben revisarse si se pretende volver también a una versión antigua del backend.

La ampliación hacia 5.000 ingredientes será una fase posterior con revisión de nombres, duplicados, procedencia y alérgenos. Las excepciones señaladas no bloquean la búsqueda, pero no se consideran clasificaciones definitivas.
