# Ensayo de reclasificación de ingredientes

**Continuación:** la implementación adoptó una clasificación visual adicional, sin aplicar esta migración de columnas. Véase [implementación y publicación](ingredient-taxonomy-v2-implementation.md). Este documento conserva los resultados del ensayo previo.

18 de septiembre de 2026. **Ensayo completado sobre una copia MySQL aislada. La reclasificación no está publicada y la propuesta aún no está lista para producción.**

## Resultado comprobado

Se exportó una instantánea consistente de la base conectada mediante `mysqldump --single-transaction`, se importó en un proceso MySQL independiente en localhost y se ensayó una reclasificación de 119 fichas. Se compararon las filas de las 43 tablas antes y después. Fuera de los dos campos de clasificación y las nuevas categorías temporales, las filas permanecieron idénticas.

Se comprobaron expresamente 172 relaciones de recetas, 209 registros de existencias por tienda, 17 extras, 104 configuraciones de uso/precio por categoría de carta, 9 perfiles de ingredientes por negocio y 582 ventas. También permanecieron intactos los nombres, claves, imágenes, alérgenos, traducciones y asociaciones locales.

Se provocó un fallo después de la primera actualización: la transacción no dejó cambios parciales. Después se realizó el cambio completo del subconjunto resuelto y su reversión; todas las filas copiadas volvieron a coincidir con el estado inicial. Los contadores internos de autoincremento de MySQL pueden avanzar durante el ensayo, incluso al deshacer inserciones; no se afirma una restauración física idéntica del servidor.

**Este resultado valida la conservación de los datos del subconjunto ensayado.** Aún faltan la resolución de excepciones, los cambios de compatibilidad de la aplicación y pruebas de los flujos completos de backoffice, carta y TPV.

## Dos conjuntos distintos

- **Lista maestra:** 3.014 opciones. Hay 3.006 destinos propuestos y 8 fichas en revisión. No se han añadido ingredientes ni cambiado los datos maestros actuales.
- **Base copiada:** 135 ingredientes, de los cuales 131 son globales. Se ensayaron 119; se conservaron 9 fichas globales pendientes, 3 entradas operativas `Random selection` y 4 ingredientes locales.
- De las 119 fichas ensayadas, 84 tienen decisiones explícitas para claves históricas inglesas. Son decisiones de clasificación, **no equivalencias que permitan fusionar o renombrar identidades**.

## Reparto propuesto de la lista maestra

| Categoría | Destinos propuestos |
| --- | ---: |
| Carnes y aves | 123 |
| Embutidos y charcutería | 132 |
| Pescados y mariscos | 856 |
| Quesos | 438 |
| Lácteos y huevos | 35 |
| Verduras, setas y algas | 368 |
| Frutas | 287 |
| Legumbres y proteínas vegetales | 108 |
| Pastas, arroces y cereales | 43 |
| Panes, masas y harinas | 39 |
| Frutos secos y semillas | 40 |
| Aceites, grasas y vinagres | 77 |
| Salsas, condimentos y bases de cocina | 295 |
| Repostería y auxiliares culinarios | 165 |
| Pendientes de clasificación | 8 |
| **Total** | **3.014** |

La organización es culinaria. Las harinas van con harinas, incluidas las de frutos secos; las semillas usadas como especias van con condimentos; las pastas puras de frutos secos van con frutos secos. Mantequilla y manteca de cacao se agrupan como grasas. Las salsas de queso se agrupan como salsas. Se conservan las alternativas de queso dentro de su familia culinaria; la categoría no certifica composición, alérgenos ni aptitud dietética. La continuidad de una familia existente no equivale a una nueva revisión de cada formulación.

## Excepciones que impiden cerrar la propuesta

En la lista maestra:

- Caracoles malteses y escargots de Bourgogne: decidir cómo cubrir moluscos terrestres con estas etiquetas.
- Cigarras y gusanos mopani: las 14 etiquetas propuestas no cubren claramente estos ingredientes.
- Cremas de avellanas, cacahuete y pistacho: falta distinguir pasta pura de preparación dulce formulada.
- Tempura: falta distinguir mezcla de rebozado de alimento ya preparado.

En las fichas de la base copiada:

- Pavo está clasificado como embutido; confirmar si se trata de fiambre o carne.
- Avellana blanca, Avellana tradicional, Pistacho y Crema de coco necesitan precisar su composición.
- Maíz, Extracto de paprika, Relleno de Mozzarela y 1kg Relleno de Mozzarela no tienen clave canónica. Se conservan sus IDs y relaciones; no se asigna una identidad por semejanza del nombre. Las dos fichas de relleno no se fusionan.

Los 8 casos maestros y los 9 casos de la base son recuentos de conjuntos diferentes y pueden referirse a conceptos relacionados. Tampoco sustituyen a las 25 identidades ambiguas que ya estaban separadas de la lista maestra antes de este trabajo.

## Dependencias de la futura entrega

1. Cerrar los destinos y registrar las excepciones por identidad. Resolver el alcance de las etiquetas para las familias que hoy quedan fuera.
2. Introducir la clasificación versionada con compatibilidad para las categorías antiguas. Conservar IDs, claves canónicas y el historial de investigación. No reinterpretar retroactivamente los lotes de procedencia.
3. Unificar los diccionarios del catálogo, inventario, TPV, altas y equivalencias. Hoy `AROMAS_Y_EXTRACTOS` apunta a `extras` en altas y a `herbs_spices` en el mapeo histórico; ambas rutas deben acordar la nueva clasificación.
4. Adaptar las siete traducciones de categorías, el catálogo espejo y el validador que actualmente exige las 14 categorías originales. Mantener diferenciadas las categorías de ingredientes y las categorías de la carta.
5. Revisar las sugerencias de coste basadas en familias: sus resultados pueden cambiar aunque los precios guardados permanezcan idénticos.
6. Ensayar la entrega completa en una copia nueva: filtros, edición, creación, recetas, extras, disponibilidad, retirada de ingredientes, pedidos y TPV. La prueba actual compara datos; no ejecuta un pedido completo con la nueva interfaz.
7. Preparar migración de producción y reversión con comprobaciones de concurrencia y copia reciente. Los comandos de este ensayo rechazan destinos remotos y no sirven para publicar.
8. Ampliar hacia 5.000 ingredientes en una entrega posterior.

No hay cambio de esquema de la aplicación, importación de nuevas fichas, despliegue ni aviso a administradores en esta fase. Las familias de segundo nivel siguen siendo una decisión de diseño pendiente.

## Evidencia y reproducción

- [Mapa de las 3.014 opciones](ingredient-taxonomy-v2-plan.json).
- [Plan de las fichas copiadas](ingredient-taxonomy-v2-database-plan.json).
- [Resultado estructurado del ensayo](ingredient-taxonomy-v2-rehearsal.json).
- Reglas de propuesta: `scripts/lib/ingredientTaxonomyRules.js` y `scripts/lib/ingredientTaxonomyLegacyDatabase.js`.
- Pruebas: `node --test tests/ingredientTaxonomyRehearsal.test.js` — 9 pruebas satisfactorias.
- Validador original: `node ../volta-storefront/scripts/validate-ingredient-master.cjs` — satisfactorio; 3.014 fichas, 14 categorías actuales, 11 redirecciones y 25 identidades pendientes preservadas.

La instantánea se cerró a las 00:33 del 18 de septiembre, hora de Madrid. SHA-256: `a0388357b8615ad91bb5ae1f70b205f48212163d499cdaaad3e19ab23fbe3a63`. El volcado contiene datos privados del negocio y está excluido de Git en `.cache/ingredient-taxonomy/2026-09-17T22-31-22-851Z/`. Las credenciales del servidor aislado también están excluidas de Git. El proceso MySQL de ensayo se detiene al concluir y la copia se conserva para repetir la comprobación.

Desde el backend, con ambos repositorios presentes:

```powershell
node scripts/planIngredientTaxonomy.js
node --test tests/ingredientTaxonomyRehearsal.test.js
./scripts/startIngredientTaxonomySandbox.ps1 -Resume
$sandboxConfig = Get-Content -Raw .cache/ingredient-taxonomy-sandbox/local.json | ConvertFrom-Json
$env:TAXONOMY_REHEARSAL_DATABASE_URL = $sandboxConfig.url
node scripts/rehearseIngredientTaxonomy.js .cache/ingredient-taxonomy/2026-09-17T22-31-22-851Z
node scripts/stopIngredientTaxonomySandbox.js
```

Para una instantánea nueva, `snapshotIngredientTaxonomy.js` solo lee el origen. La importación con `importIngredientTaxonomySnapshot.js <directorio>` exige una base aislada vacía y comprueba la huella del volcado. La utilidad de copia de seguridad habitual no incluye todas las tablas de ingredientes, por lo que su exportación parcial no sustituye al volcado utilizado aquí.
