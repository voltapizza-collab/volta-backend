Estado de publicación (2026-09-17T11:45:22.456Z): backend fdfe492 y storefront 2314d2f disponibles en producción. Migración 20260917120000_preserve_ingredient_catalog aplicada y comprobada. Las novedades están activadas en cinco idiomas. Los apartados siguientes conservan el historial de implementación y validación local.

# Avisos especiales de platos

Implementación local del 17 de septiembre de 2026; pendiente de publicar backend y storefront juntos. No requiere migración: reutiliza `MenuPizza.productTags`.

- Pizza Creator ofrece Picante, Vegano, Vegetariano, Sin gluten, Kosher y Halal. Las casillas permiten cualquier combinación. Marcar todos / Quitar todos operan solo sobre los avisos y no envían el formulario. El selector está traducido a ES/EN/IT/FR/PT.
- Claves admitidas por la API: `spicy`, `vegan`, `vegetarian`, `gluten_free`, `kosher`, `halal`. Se admiten JSON y campos multipart, sin duplicados. Una edición que omite `productTags` conserva los existentes; `[]` los elimina explícitamente.
- La carta muestra una sola etiqueta para todos los avisos, alternando el texto con desplazamiento vertical cada tres segundos y el color correspondiente: naranja para Picante, verde para Vegano, verde azulado para Vegetariano, ocre para Sin gluten, azul para Kosher y ciruela para Halal. Mantiene 22 px de alto y un ancho estable durante el ciclo. El nombre accesible y el título contienen todos los avisos; la ficha del plato los muestra simultáneamente.
- La animación se pausa al mantener el puntero o el foco dentro de la tarjeta. Con movimiento reducido del sistema, los textos y colores cambian sin desplazamiento y conservan el mismo espacio. No se añaden etiquetas automáticamente ni se cambian los alérgenos del producto.
- El aviso de publicación `productSpecialNoticesAnnouncement` está preparado en cinco idiomas, sin fecha y fuera del catálogo activo hasta que ambos despliegues estén disponibles. Un backend antiguo descartaría las claves nuevas: publicar primero el backend.

Verificación: prueba HTTP de creación JSON y edición multipart, conservación y eliminación explícita de avisos; selector y etiqueta accesible; integración de la tarjeta y ficha de StorePage; revisión visual de escritorio y móvil, recorrido de los cinco textos con sus colores, separación del botón de compra y movimiento reducido. Capturas de demostración con datos ficticios en `../output/product-notices/`.

Resultado final: 9 pruebas de backend y 8 de frontend correctas; compilación de producción correcta. La comprobación visual usa la estructura de tarjeta y los estilos reales del catálogo a 1440, 900, 393 y 320 px, verifica ciclos de dos a cinco avisos y confirma que los textos no se cortan ni se solapan con el botón de compra. Informe: `../output/product-notices/verification.json`.

## Corrección de la sesión local de Tropical Trance

El servidor local de 8080 llevaba iniciado desde las 10:45, antes de añadir `vegetarian`, aunque el frontend de 3000 ya servía la compilación actualizada. La lectura de la ficha y la carta devolvía `productTags: []` para Tropical Trance (producto 70, negocio 1) después del intento de guardado del usuario.

Se reinició el backend local con el código actualizado y se recuperó la selección solicitada modificando únicamente `MenuPizza.productTags`, con comprobación de identidad y del valor anterior. Respaldo e informe en `../output/product-notices/tropical-trance-repair.json`. La API de Pizza Creator y la carta devuelven `["vegetarian"]`; se comprobó visualmente la etiqueta en la tarjeta real de `http://localhost:3000/mycrushpizza/plaza-diario`. La publicación de código en producción sigue pendiente.

## Posición de las etiquetas en escritorio

Se corrigió `CatalogDesktop.css` para que, a partir de 561 px, los avisos especiales aparezcan sobre la esquina superior izquierda de la foto y no ocupen una fila centrada debajo. Los contadores de oferta (`lsf-offerRibbon` y `lsf-categoryDealCountdown`) se alinean al borde derecho debajo de la imagen, tanto en las tarjetas flex de escritorio como en las tarjetas grid intermedias.

Verificado en la carta local real con Hot Queen, Vegetariana y 4 Quesos a 1440, 1024, 740 y 393 px; se conservan los colores y la rotación de los avisos. Compilación correcta (`main.01292a5e.css`) y 7 pruebas del catálogo de notificaciones correctas. La nota de publicación incluye el ajuste en ES/EN/IT/FR/PT y sigue pendiente de activar junto con el despliegue público.

## Sexto aviso: Halal

Añadido `halal` de forma independiente de `kosher` en la API y en los cinco idiomas del selector. La etiqueta usa color ciruela y la ficha del producto incluye su aviso. El ciclo de seis avisos dura 18 segundos, manteniendo tres segundos por aviso y 22 px de alto. No se asignan avisos a productos automáticamente.

Verificación: 9 pruebas de backend y 8 de frontend correctas, con selección independiente de Halal/Kosher, creación JSON, edición multipart con Picante + Halal, conservación al omitir avisos, borrado explícito y presentación de los seis en tarjeta y ficha. Compilación correcta (`main.815d8aa0.js`, `main.1b033833.css`). Revisión visual en una muestra aislada a 1440, 393 y 320 px. Se reinició el backend local para cargar la nueva clave y se comprobó `/health` y la carta. La publicación pública continúa pendiente.
