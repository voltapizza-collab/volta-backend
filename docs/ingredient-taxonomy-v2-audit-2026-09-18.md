# Auditoría de categorías y disponibilidad de ingredientes

18 de septiembre de 2026. **Actualización: A1, A2 y A3 corregidos y comprobados en local.** No hay despliegue de producción ni validación física del Sunmi. Las reproducciones originales se conservan abajo como evidencia del antes y después.

**Continuación del mismo día:** [estado de los puntos 1–4](ingredient-audit-points-1-4-2026-09-18.md), con optimización de consultas, revisión de fichas provisionales, ensayo del nombre histórico y controles nuevos de precios/promociones. También se completó la [reparación local de reparto variable y cupones de envío](checkout-delivery-repair-2026-09-18.md), conservando la revisión manual existente cuando no hay ruta verificada. Las cifras y compilación de la sección siguiente corresponden a la reparación anterior.

## Reparación y verificación posterior

- **A1 — carrito anterior:** `services/checkoutAvailability.js` comprueba disponibilidad dentro de la transacción de creación de la venta, tanto para efectivo como para tarjeta. Consulta productos del negocio, activación de la tienda, fechas, tamaños de carta e ingredientes globales y de esa tienda. Incluye recetas, extras, personalizadas, ambas mitades, componentes de promociones y regalos. Las etiquetas de origen no eximen las referencias alimentarias. Un plato normal con ingredientes desactivados tampoco se admite por indicar que se retiran de su receta.
- Las personalizadas conservan su semántica: el plato de muestra es una referencia de categoría/precio; sus ingredientes y tamaños no se heredan. Se validan los ingredientes elegidos explícitamente, incluidos los guardados en el detalle. Esta reparación no constituye una auditoría del cálculo de precios ni de elegibilidad de promociones.
- Las filas se bloquean en orden estable hasta terminar la transacción, con aislamiento `ReadCommitted`, espera máxima de 10 s y duración máxima de 20 s. El rechazo es HTTP 409 `cart_item_unavailable`, con identificación de la línea, antes de crear la venta o la sesión externa de pago. No cancela pedidos ni sesiones de pago que ya se habían creado cuando se desactiva el ingrediente.
- **A2 — carta pública:** retirada la caché de respuestas completas de `routes/stores.js`, con `Cache-Control: no-store`. Cada petición lee la base de datos, por lo que la corrección no depende de invalidar memoria en una única instancia. El frontend consulta cada 15 s mientras es visible y al recuperar foco, visibilidad o conexión; evita peticiones solapadas y descarta respuestas de una tienda abandonada. El intervalo más la duración de la petición determina el retraso visual: no se presenta como actualización instantánea. Checkout comprueba el estado independientemente.
- Al rechazar el pedido, se conserva el carrito, se identifica el artículo y se actualiza la carta. No se eliminan silenciosamente las elecciones del cliente.
- **A3 — inventario:** la reparación del cliente Prisma y los estados de carga/error continúan operativos. Después de actualizar localhost, `/stores/1/ingredients?locale=es` devuelve 200 y 131 ingredientes; la carta de Plaza Diario devuelve 200, 48 platos y `no-store`.

**Evidencia nueva:**

| Comprobación | Resultado |
| --- | --- |
| Carritos contra MySQL aislado | 24 casos: seis tipos de línea × activo/desactivado × efectivo/tarjeta. Los 12 controles activos alcanzan la venta y se revierten; los 12 desactivados devuelven 409 sin venta. [Informe](ingredient-taxonomy-v2-checkout-repair-audit.json). |
| Concurrencia real | OFF pendiente hace esperar al checkout, que rechaza tras el commit. Checkout validado hace esperar al OFF hasta finalizar. [Informe](ingredient-taxonomy-v2-concurrency-audit.json). |
| Ciclos del POS | 97 combinaciones ingrediente/tienda; 55 ciclos adicionales de carta pública en tiendas 1, 5 y 6, comprobando retirada y reaparición inmediata al consultar y cabeceras sin caché. Cero hallazgos. [Informe](ingredient-taxonomy-v2-flow-repair-audit.json). |
| Conservación | Las 43 tablas se restauran exactamente tras cada ensayo. Ningún pago, mensaje externo ni pedido persistente en la copia de datos operativos. |
| Backend | 250 pruebas satisfactorias en la suite completa y una prueba adicional de cupones satisfactoria en una base vacía y aislada: 251 en total. La prueba de cupones cubre efectivo, tarjeta simulada, reserva, consumo y liberación; sus datos de prueba se limpian. Tras el último ajuste, 34 pruebas focalizadas satisfactorias y repetición de checkout y concurrencia MySQL. |
| Frontend | 188 pruebas satisfactorias, incluidas refresco periódico, foco, reconexión, visibilidad, eliminación de listeners, conservación del carrito y aviso de rechazo. |
| Compilación y navegador | Compilación satisfactoria, `main.fbfe9845.js`. En una simulación local sin servicios externos, el navegador verifica el aviso, la línea señalada y el carrito conservado en escritorio y 390 px. Las pruebas del navegador usan respuestas controladas; las pruebas MySQL son las de los informes anteriores. |

La compilación se preparó en `output/availability-repair-build` y se copió a la carpeta servida con el índice al final. El backend local se reinició con `NODE_ENV=test`, conservando deshabilitado el worker automático de reseñas; tras el último reinicio, la disponibilidad devuelve HTTP 200. El servidor de simulación y el MySQL aislado quedaron detenidos. No hay migración de esquema requerida. `checkoutAvailabilityAnnouncementDraft` incluye ES/EN/IT/FR/PT y queda fuera del feed hasta la entrega coordinada.

Retirar la caché aumenta las lecturas; los bloqueos pueden serializar pedidos que compartan productos o ingredientes. Falta medir carga representativa antes de afirmar capacidad en producción. La consulta manual de la carta en localhost tardó aproximadamente 9,5 s con la conexión habitual; este dato no equivale a una medición de carga ni a latencia de producción.

## Alcance y entorno

Se auditó el código local de backend y storefront, incluidos catálogo, clasificación compartida, inventario del backoffice, inventario del POS web, selección de ingredientes, recetas, extras y checkout. Referencias de base: backend `2246964c0686d50b0fee47e8baeab14c8ddbc767`; storefront `2314d2f2d5f6ecbbf3ca8b595d4fb0b7e17ff06d`, con los cambios locales de reorganización.

Las pruebas con escrituras utilizaron exclusivamente `ingredient_taxonomy_rehearsal`, en un proceso MySQL separado en loopback. Se reutilizó la instantánea de las 00:33 del 18 de septiembre, hora de Madrid. No se volvió a consultar producción ni se publicó código. Los scripts rechazan conexiones remotas y no usan `DATABASE_URL` como alternativa al destino de ensayo.

Se deshabilitaron los destinatarios SMS únicamente en la copia durante los ciclos del POS y se restauró su configuración al terminar. Las pruebas de checkout usaron efectivo y deshicieron la transacción después de alcanzar la creación de la venta; no hubo cobros, mensajes ni pedidos persistentes. Los contadores internos de autoincremento pueden avanzar aunque se revierta una transacción.

## Hallazgos originales, anteriores a la reparación

### A1 — Alta: checkout acepta un ingrediente desactivado

**Reproducción:** obtener un plato disponible, conservar su línea de carrito, desactivar uno de sus ingredientes y enviar ese carrito al checkout. El plato desaparece del menú calculado directamente, pero el checkout llega a crear una venta con estado `PAID` para pago en efectivo. El ensayo intercepta y revierte esa transacción: el código 418 `AUDIT_ROLLBACK_AFTER_SALE` del informe es una señal del ensayo, no un rechazo del producto.

Se reprodujo en cuatro variantes: receta normal, extra añadido a otro plato, producto personalizado y mitad y mitad. Los cuatro controles con el ingrediente activo también alcanzaron la venta. Evidencia: [checkout sobre copia](ingredient-taxonomy-v2-checkout-audit.json).

El código de `routes/checkout.js` valida horarios, retiradas de ingredientes y promociones, pero no vuelve a comprobar las existencias activas de recetas, extras y personalizaciones antes de guardar la venta. La revisión de `HEAD` confirma que esta ausencia es anterior al cambio de categorías.

**Corrección necesaria:** validar en el servidor las identidades y la disponibilidad actual de todos los componentes, para la tienda del pedido, antes de cualquier venta o sesión de pago. Repetir la validación dentro de la transacción y cubrir cambios concurrentes. Debe incluir recetas, extras, personalizadas, mitades y componentes de promociones; retirar un ingrediente no debe permitir eludir las reglas que se acuerden para un plato indisponible. Repetir estas pruebas con efectivo y tarjeta simulada, sin contactar al proveedor.

### A2 — Alta: la carta pública conserva platos en caché tras desactivar

**Reproducción:** cargar la carta pública de la tienda 1, desactivar el ingrediente 28 desde el controlador usado por el POS y consultar de nuevo la carta. La respuesta cacheada aún contiene los platos 2, 10, 20, 37, 38, 52 y 69, mientras el cálculo directo ya los ha retirado.

`routes/stores.js` mantiene la respuesta durante 30.000 ms por defecto; `routes/storeIngredients.js` no invalida esa entrada al cambiar disponibilidad. Evidencia: [ciclos de inventario](ingredient-taxonomy-v2-flow-audit.json), hallazgo `PUBLIC_MENU_CACHE_RETAINS_DISABLED`. La misma caché existe en `HEAD`, antes de esta reorganización.

Además, por inspección de `StorePage.jsx`, una carta que ya estaba abierta no recarga sus productos periódicamente: la consulta periódica de disponibilidad actualiza horarios, no el menú. Por ello los 30 segundos de caché **no son una garantía de actualización de una pestaña abierta**.

**Corrección necesaria:** invalidar la carta de las tiendas afectadas y definir cómo se actualizan carta y carrito ya abiertos. La validación de checkout de A1 sigue siendo necesaria aunque la interfaz se refresque. Considerar invalidación entre procesos si producción usa varias instancias.

## Comprobaciones satisfactorias

| Área | Resultado y límite |
| --- | --- |
| Lista maestra | 3.014 identidades, cobertura de 14 familias, siete traducciones, igualdad del manifiesto y del resolutor entre aplicaciones. Se conservan 11 redirecciones y 25 identidades ambiguas apartadas. |
| Lecturas reales de API | 30 consultas a catálogo, inventarios y usos por categoría. 131 fichas del catálogo global; las 43 tablas no cambiaron. |
| POS: activar/desactivar | 97 combinaciones de ingrediente y tienda: 54 ingredientes distintos en las tiendas 1, 2, 5 y 6. Desactivación, segundo OFF, reactivación y rechazo de operaciones dirigidas a otra tienda. |
| Carta calculada sin caché | 290 relaciones con platos afectados comprobadas durante los ciclos; desaparecen únicamente los platos dependientes y reaparecen con las mismas recetas y precios. No equivale a aprobar la carta pública cacheada. |
| Extras y personalización disponibles | 178 combinaciones con categorías de uso comprobadas. El ingrediente desactivado desaparece del selector; los demás ingredientes y precios permanecen iguales y la reactivación restaura la respuesta. |
| Conservación | Tras restaurar los campos de prueba, las filas de las 43 tablas coinciden con las anteriores, incluidos recetas, stock, precios, extras, perfiles por negocio y ventas. Los hashes del ensayo operativo coinciden con la verificación final de lecturas. |
| Interfaz POS automatizada | Tres pruebas nuevas: familia/contador/ID/tienda y sincronización; búsqueda por familia e identidad local; error y escritura pendiente sin cambios falsos ni envío duplicado. |
| Navegador con API de copia | Nachos: Panes, masas y harinas 1/1 → OFF 0/1 → Sync mantiene OFF → ACTIVE 1/1. Buscar «masas» devuelve Nachos. En 390 y 320 px no se detectó desbordamiento horizontal de las categorías. |
| Suite backend | 230 satisfactorias, 0 fallos, 1 omitida. La omitida es la prueba opcional MySQL de concurrencia de cupones; no cubre categorías. Se usó una clave ficticia de Stripe para que las pruebas de tarjeta no se detuvieran por falta de configuración; no se hicieron pagos. |
| Suite interfaz | Las 172 pruebas existentes y las 3 pruebas nuevas del POS pasaron: 175 en total. |
| Compilación | Compilación de producción del storefront correcta. Paquete de interfaz nativa del POS generado correctamente en `output/taxonomy-audit-native`; no es una instalación ni una prueba física del terminal. |

Las pruebas operativas de la copia recorren nueve familias alimentarias y «Selecciones especiales», que son las presentes entre los ingredientes activos utilizados. No todas las 14 familias tienen existencias activas en esta instantánea. La cobertura completa de las 14 familias corresponde al clasificador y al catálogo maestro, no a un ciclo operativo con datos reales de cada familia.

## Pendientes adicionales y límites

### A3 — Inventario vacío en el localhost habitual: corregido

Después de esta auditoría, el usuario mostró el inventario del backoffice vacío. Se reprodujo HTTP 500 en `http://localhost:8080/stores/1/ingredients?locale=es`. Una consulta mínima con el cliente Prisma habitual falló con `Unknown nested field 'catalogState' for operation findManyIngredient does not match any query`. El cliente JavaScript y su esquema generado estaban desincronizados; el esquema generado en `node_modules/.prisma/client/schema.prisma` no incluía esa relación.

La auditoría inicial utilizó un cliente generado aparte y no comprobó este proceso habitual: esa diferencia de entorno dejó el problema sin detectar. Se detuvo únicamente el backend que escuchaba en 8080, se ejecutó `prisma generate` satisfactoriamente con el esquema existente y se reinició ese backend. No se ejecutó una migración ni una carga de ingredientes. El servidor local quedó en `NODE_ENV=test` para mantener desactivado el worker automático de reseñas durante estas comprobaciones.

Resultado: el endpoint habitual respondió HTTP 200 con **131 ingredientes y 12 agrupaciones presentes**. Se actualizó también el inventario para mostrar carga, error con Reintentar, respuesta realmente vacía y falta de contexto de tienda, con traducciones ES/EN/IT/FR/PT. Las respuestas tardías de otra tienda no pueden reemplazar la lista actual. Los errores no se presentan como una lista vacía.

Validación adicional: 14 pruebas de inventario y ficha satisfactorias, 8 pruebas de avisos satisfactorias y compilación correcta. En una vista aislada de solo lectura, alimentada con la respuesta real de localhost, se simuló un error 500: apareció Retry, el reintento restauró las categorías, el cambio a ES mostró las familias en español y Panes, masas y harinas abrió Nachos. Esta comprobación no editó ni activó ingredientes.

La compilación inicial de esta reparación se preparó fuera de la carpeta servida y se copió a `volta-storefront/build` tras completarse (`main.62276266.js`, sustituido por la compilación posterior indicada al principio). La nota `inventoryLoadRecoveryAnnouncementDraft` queda fuera del feed hasta publicar la mejora. En ese momento A1 y A2 estaban pendientes; su cierre local se documenta al principio.

### Resto de pendientes

- Sunmi: la interfaz va empaquetada en el APK. Publicar solo la web no actualiza los terminales instalados. Falta generar/distribuir el APK por el proceso habitual y repetir el ciclo en el equipo físico, con su autenticación y puente Android. La auditoría web usa una sesión local de prueba y comprueba el control de tienda del servidor; no acredita el hardware ni la firma del dispositivo.
- Conservan clasificación provisional las cuatro fichas maestras de tempura y cremas, y las nueve fichas históricas documentadas en [implementación](ingredient-taxonomy-v2-implementation.md). No se han resuelto composiciones ni equivalencias por similitud de nombre.
- En la copia el POS aún muestra un nombre histórico dañado, «R�CULA». Se observó en el buscador; no procede de las nuevas etiquetas de categoría. La limpieza de la lista maestra no demuestra que todos los nombres operativos antiguos estén corregidos.
- No se ejecutaron cobros reales, notificaciones externas ni impresión física. La prueba de concurrencia entre desactivación y checkout sí se completó durante la reparación posterior. No hay certificación integral de producción.
- Las categorías de ingredientes siguen separadas de las categorías comerciales de carta. No se modificaron esas categorías, los precios guardados ni las reglas de cálculo de sugerencias de coste.

## Entregables y reproducción

- `scripts/auditIngredientTaxonomyFlows.js`: ciclos por tienda, carta directa, extras, aislamiento y comparación completa de tablas.
- `scripts/auditIngredientCheckoutAvailability.js`: carritos previos al cambio, seis variantes, efectivo/tarjeta y transacciones de venta revertidas.
- `scripts/auditCheckoutAvailabilityConcurrency.js`: dos órdenes de concurrencia reales entre OFF y validación de checkout.
- `src/pos/PosInventoryTaxonomy.test.jsx` en storefront: nuevas pruebas de interacción.
- `package.json` del backend: las pruebas de clasificación y ensayo se incorporaron a `npm test`, para que no dependan de recordar una orden separada.
- Informes JSON enlazados y registros en `output/taxonomy-audit-*.log` del workspace.

Con el MySQL aislado iniciado y el cliente Prisma generado con el esquema actual, cargar `TAXONOMY_REHEARSAL_DATABASE_URL` desde la configuración privada local y ejecutar los tres scripts de auditoría por separado. La reparación posterior usa el cliente Prisma habitual, ya regenerado; el cliente alternativo corresponde únicamente a la auditoría inicial. No ejecutar pruebas con escrituras en paralelo sobre la misma copia.

**Pendiente para producción:** validar el Sunmi físico y la carga, y publicar backend y storefront de forma coordinada. A1 y A2 ya tienen corrección y regresiones locales; producción conserva su versión anterior.
