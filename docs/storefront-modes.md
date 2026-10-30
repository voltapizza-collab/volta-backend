# Modos del storefront

PATCH `/partners/by-id/:partnerId/storefront-mode` acepta únicamente `commercial-light`, `commercial-dark` o `sepia` y actualiza solo `Partner.storefrontMode`. Usa la autorización existente de backoffice: el negocio solo puede cambiar su propio modo; Global Manager conserva su alcance. Se valida el identificador y la existencia del restaurante. Los colores y los ajustes de botones existentes se conservan. No necesita migración: la columna ya existe.

Publicar la ruta antes que la nueva pantalla de personalización del storefront. `storefrontModesAnnouncementDraft` contiene la nota en ES/EN/IT/FR/PT y queda fuera del feed hasta comprobar ambos despliegues. Ningún negocio cambia automáticamente a oscuro.

Pruebas: `node --test tests/storefrontMode.test.js tests/webAccess.test.js tests/backofficeNotifications.test.js`.
