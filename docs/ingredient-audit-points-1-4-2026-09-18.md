# Continuación de auditoría: puntos 1–4

**Actualización posterior:** [reparación del reparto variable y cupones de envío](checkout-delivery-repair-2026-09-18.md). El pendiente de tarifa variable descrito abajo corresponde al estado anterior: ahora tiene corrección y pruebas locales, conservando la alternativa existente de tarifa base con revisión manual. La auditoría integral de producción y la prueba física siguen pendientes.

18 de septiembre de 2026. Trabajo local; **sin despliegue, migraciones ni escrituras en la base compartida**. El Sunmi físico y su actualización quedan para el 19 de septiembre, según lo acordado con Luigi. Las pruebas con escrituras usan exclusivamente MySQL de loopback `ingredient_taxonomy_rehearsal` o la base vacía `coupon_flow_test`.

## 1. Carga de la carta

La lectura de productos, categorías, recetas y existencias usa una consulta parametrizada con uniones, en lugar de varias consultas anidadas. Las consultas independientes se ejecutan juntas. La carta sigue leyendo disponibilidad en cada petición y devuelve `Cache-Control: no-store`.

| Medición | Antes | Después |
| --- | --- | --- |
| Consultas SQL, petición con conexiones calientes | 17 | 10 |
| Copia aislada, petición caliente | 149 ms | 127 ms |
| Copia aislada, 12 peticiones simultáneas, p95 | 1067 ms | 1008 ms |
| Localhost habitual, primera petición observada | 9201 ms | 4394 ms |
| Localhost habitual, peticiones posteriores | 3601 ms | 2739 y 2704 ms |

Son muestras de diagnóstico, no una garantía de latencia ni una prueba de capacidad en producción. Sigue habiendo latencia de conexión en el localhost habitual. El resultado de productos/recetas/stock/precios coincide con la consulta anterior en las cuatro tiendas activas (50, 4, 1 y 0 productos), normalizando los valores vacíos que ya normalizaba la respuesta pública.

Evidencias: [antes](menu-performance-before.json), [después](menu-performance-after.json), [localhost habitual](menu-performance-localhost.json), [equivalencia de consulta](menu-query-equivalence.json). Inventario habitual: HTTP 200, 131 ingredientes. Carta habitual: HTTP 200, 48 platos, sin caché.

## 2. Clasificaciones provisionales

Se revisaron descripción, traducciones, alérgenos y uso en recetas de las nueve fichas históricas pendientes. Las descripciones están vacías; las traducciones no prueban la composición de las cremas. No se cambiaron familias ni se crearon equivalencias por similitud.

| Ficha histórica | Identidad conservada | Situación |
| --- | --- | --- |
| 25 Pavo | `turkey` | Confirmar carne de ave o fiambre. |
| 57 Avellana blanca | `white_hazelnut_cream` | Traducciones de crema; confirmar composición dulce o pasta pura. |
| 58 Avellana tradicional | `hazelnut_cream` | Misma duda; aparece en recetas dulces, lo que no prueba su formulación. |
| 61 Pistacho | `pistachio_cream` | Confirmar crema formulada o pasta pura. |
| 62 Crema de coco | `coconut_cream` | Confirmar preparación endulzada o crema de coco sin endulzar. |
| 47 Maíz | sin canonicalKey | Familia vegetal razonable; falta resolver identidad, no fusionar automáticamente con `sweet_corn`. |
| 54 Relleno de Mozzarela | sin canonicalKey | Quesos; conservar ficha y vínculos. No fusionar con 126. |
| 126 1kg Relleno de Mozzarela | sin canonicalKey | Quesos; conservar presentación e identidad separada de 54. |
| 75 Extracto de paprika | sin canonicalKey | Condimentos/extractos; falta identidad, no redirigir automáticamente a `pimenton_extract`. |

En el maestro siguen provisionales `tempura`, `crema_de_avellanas`, `crema_de_cacahuete` y `crema_de_pistacho`. Se pidió a Luigi la composición real. **Este punto no está cerrado.** No confundir dudas de clasificación con ausencia de una identidad canónica revisada.

## 3. Nombres históricos dañados

La inspección de las 135 fichas operativas y sus traducciones detectó una ficha con el carácter de sustitución: ID 135, `R�cula`, clave `r_cula`. Las traducciones existentes EN Arugula, IT Rucola, FR Roquette y PT Rúcula respaldan el nombre `Rúcula`.

`data/ingredientNameRepairs.js` contiene la reparación exacta, con guardas de ID, clave, categoría, valor anterior y traducciones. `scripts/rehearseIngredientNameRepairs.js` la aplica dos veces dentro de una transacción aislada, verifica idempotencia y que solo cambió el nombre, y revierte. Las 43 tablas quedan idénticas. No modifica canonicalKey, recetas, precios, stock, alias ni fichas duplicadas.

Evidencia: [ensayo de reparación](ingredient-name-repair-rehearsal.json). **Preparada y comprobada; pendiente de aplicar a los datos operativos en la entrega acordada.** Por tanto, el nombre antiguo puede seguir viéndose en el localhost conectado a esos datos.

## 4. Precios y promociones

Se reprodujo en la copia un producto de 9,99 € aceptado por 0,50 €, un subtotal falsificado y una promoción inexistente aceptada. Se revirtieron las ventas y no se contactó con proveedores de pago. [Evidencia anterior](checkout-pricing-before.json).

Correcciones locales:

- Checkout contrasta precio y subtotal con la carta, recargos/descuentos activos y precios de extras por categoría/tamaño. Usa la moneda del negocio.
- Mitades: precio mayor de los dos platos y extras por lado. Personalizadas: base de categoría, coste por negocio, tamaño, cantidad y colocación. No heredan los ingredientes de la receta de muestra; se conserva ese caso válido aunque la receta original quede indisponible.
- Trending conserva la banda ya anunciada de ±0,50 €; la guarda impide salirse de ella y normaliza el desglose económico. No convierte esa oscilación existente en un precio fijo.
- Promociones: existencia, vigencia, cantidad y composición autorizada, incluyendo grupos de elección solapados. Incentivos: vigencia, producto y tamaño de regalo, una unidad y umbral de gasto elegible después del cupón, excluyendo promociones, descuentos y boost.
- Boost: precio unitario, posiciones y reparto económico desde los datos del servidor. Si la cola cambió, la oferta se rechaza para revisar el carrito.
- Se repite la comprobación dentro de la transacción, antes de cliente/venta/pago; promociones e incentivos solicitados se bloquean mientras se comprueban. La elegibilidad del cupón también se contrasta nuevamente.
- Los errores de precio/oferta/composición conservan el carrito, señalan la línea y recargan la carta, indicando cómo revisarla.
- El selector de extras filtra ingredientes globalmente desactivados y existencias desactivadas o ausentes en la tienda, comprobando también pertenencia de la tienda al negocio.

Evidencias: [precios, controles válidos y cambios entre lectura y transacción](checkout-pricing-after.json), [carritos con ingredientes activos/desactivados](ingredient-taxonomy-v2-checkout-repair-audit.json), [ciclos del POS y selectores](ingredient-taxonomy-v2-flow-repair-audit.json), [concurrencia real OFF/checkout](ingredient-taxonomy-v2-concurrency-audit.json).

**Pendiente detectado, no reparado ni certificado:** `computeCheckoutDeliveryFee` aún recibe `distanceKm` del navegador para la tarifa variable y admite `deliveryFee` del cliente como alternativa. Resolverlo requiere validar la dirección/distancia en el servidor y definir qué hacer cuando no se puede obtener una ruta. Se consultó a Luigi si debe bloquearse el pago para revisar la dirección o admitir tarifa base con confirmación manual. No se ha cambiado unilateralmente esa política. Por este motivo **la auditoría económica integral sigue abierta**.

## Estado de entrega

Verificación final: 262 pruebas de backend satisfactorias y la prueba adicional MySQL de cupones satisfactoria; 191 pruebas de frontend. Pruebas HTTP sobre datos de copia: 36 escenarios de precios, 28 de disponibilidad, 97 ciclos ingrediente/tienda, 55 ciclos de carta pública y 33 comprobaciones de categorías de extras. Cero hallazgos en esos escenarios. Los controles válidos llegan a crear una venta dentro de una transacción que se revierte antes de contactar al proveedor; los casos inválidos se rechazan. Dos ordenamientos concurrentes OFF/checkout verificados. Las 43 tablas originales quedan restauradas.

Backend y storefront conservan todos los cambios anteriores. Frontend local compilado en `output/audit-today-build` y copiado con el índice al final: `main.efbc4463.js`. Backend habitual en `NODE_ENV=test` para mantener detenido el worker de reseñas. No se publicaron avisos: `checkoutPricingAnnouncementDraft` contiene ES/EN/IT/FR/PT y queda fuera del feed hasta la entrega coordinada.

Faltan las respuestas sobre composición y reparto variable, aplicar la reparación de nombre a los datos operativos cuando se autorice esa entrega, validar el Sunmi físico y probar carga representativa antes de desplegar. La ampliación del catálogo no forma parte de esta reparación.
