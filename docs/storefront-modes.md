# Modos del storefront

PATCH `/partners/by-id/:partnerId/storefront-mode` acepta únicamente `commercial-light`, `commercial-dark` o `sepia` y actualiza solo `Partner.storefrontMode`. Usa la autorización existente de backoffice: el negocio solo puede cambiar su propio modo; Global Manager conserva su alcance. Se valida el identificador y la existencia del restaurante. Los colores y los ajustes de botones existentes se conservan. No necesita migración: la columna ya existe.

Publicar la ruta antes que la nueva pantalla de personalización del storefront. `storefrontModesAnnouncementDraft` contiene la nota en ES/EN/IT/FR/PT y queda fuera del feed hasta comprobar ambos despliegues. Ningún negocio cambia automáticamente a oscuro.

Pruebas: `node --test tests/storefrontMode.test.js tests/webAccess.test.js tests/backofficeNotifications.test.js`.

## Publicación del 30 de octubre de 2026

Backend funcional 24a8557, Railway ab8f4ab6-e3ec-4cdb-9d66-b90584e19c6c SUCCESS; storefront 70f8888, Railway ab696113-b5bb-434d-bcc5-f8fd12cca031 SUCCESS. La tienda pública responde 200 y sirve main.0e37f51a.js y main.d11c00c9.css. El navegador confirma Sepia en MyCrushPizza y el CSS nuevo. La revisión completa de los cinco modales en claro, oscuro y sepia se realizó antes del despliegue, en móvil y escritorio; la comprobación pública no acepta condiciones de compra ni crea pedidos.

Comprobación autenticada de la nueva ruta: entrada inválida devuelve 400; acceso anónimo, 401. El modo Sepia almacenado y público se conserva. La sesión temporal se revocó al terminar. Salud de API: 200. Sin migraciones de datos. Pruebas: 21 del frontend y 19 del backend; compilación de producción correcta.

Tras verificar ambos servicios se activan las notas de modos y avisos compactos POS en ES/EN/IT/FR/PT. El POS web incorpora caa4ae0; APK 0.3.28 disponible para toda la red autorizada de terminales, con actualización pendiente según el reporte de cada terminal. No se afirma instalación física. Las actualizaciones generales se dirigen a la red de terminales; las asignaciones individuales se reservan para excepciones explícitas.