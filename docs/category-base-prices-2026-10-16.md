# Precio explícito de base por categoría — 16 de octubre de 2026

## Alcance

Global Manager conserva `Category.customizable` y `Category.halfAndHalf`. El backoffice del negocio solo modifica `PartnerCategory.customBasePrices`, un objeto JSON por tamaño. No existe un interruptor nuevo. El icono de pizza en las tarjetas abre el formulario; el icono de mitad y mitad es informativo. Un indicador ámbar señala importes pendientes.

El formulario admite los tamaños declarados en los productos de la categoría, coma/punto decimal y precios positivos con dos decimales (máximo 10.000). Un campo vacío retira ese tamaño del armado; no se copia el mínimo de carta ni se aplica el factor 0,8. Los ingredientes mantienen sus reglas anteriores y se suman por separado.

## Contrato

- `GET /api/partners/:partnerId/categories` incluye `customBasePrices` y las dos capacidades globales.
- `PATCH /api/partners/:partnerId/categories/:categoryId` acepta `{ customBasePrices: { M: 8.25 } }`. Es un ejemplo, no un precio asignado a ningún negocio.
- El middleware existente valida la sesión y el negocio de la ruta. La rama de precios rechaza propiedades extra, categorías no personalizables, tamaños ajenos, importes inválidos y fallos de persistencia; nunca devuelve un éxito de respaldo ficticio.
- El menú público adjunta `categoryBasePriceBySize`, leído mediante un JOIN de `PartnerCategory` por negocio y categoría. La actualización de Trending preserva el campo.
- StorePage toma exclusivamente los precios configurados para los tamaños disponibles. Las categorías sin permiso global o sin precios no se ofrecen para armar. Visual y rápido comparten cálculo y carrito.
- Checkout vuelve a leer esa configuración y rechaza un precio antiguo/manipulado o un tamaño sin precio. Las liquidaciones y Trending no alteran la base.

## Verificación local

- 23 pruebas: validación de importes, endpoint de guardado/fallo, aislamiento entre negocios, lectura del menú, checkout y autorización.
- 34 pruebas adicionales: avisos, disponibilidad de checkout y métodos de tienda.
- 21 pruebas frontend: formulario y persistencia/error, iconos/permisos, tarjetas y productos, flujo al carrito, ausencia de precios o capacidad global, laboratorio y armado visual.
- 36 combinaciones de tamaño, zona, cantidad y unidades contra el servicio real de precios del backend, con contexto sintético y sin base de datos.
- Prisma validate y generate correctos. Compilación de revisión en `../volta-storefront/build-category-pricing`.
- Navegador: componentes reales del backoffice en `http://127.0.0.1:4180`, con adaptador de datos sintéticos y conexiones bloqueadas por CSP. Guardar y reabrir precios comprobado; no modifica registros reales.

## Activación local completada — 16 de octubre de 2026

Tras la autorización para activar la configuración en localhost:

- Copia previa de las 116 filas de `PartnerCategory` en `_db_backups/category-base-prices-2026-10-16/partner-categories-before.json` (archivo ignorado por Git).
- Aplicada únicamente la migración pendiente `20261016120000_add_category_base_prices` a la base configurada. No se asignaron importes a ningún negocio.
- Backend actualizado disponible en `http://localhost:8080`, iniciado directamente con `node index.js`, `PORT=8080` y `NODE_ENV=test`. En este código, ese modo evita el worker automático de SMS de reseñas; la autenticación y la persistencia siguen activas.
- Storefront recompilado en `build` con `REACT_APP_API_URL=http://localhost:8080`, servido por `localhost:3000`. El backoffice real está en `/backoffice/mycrushpizza`; la vista 4180 sigue siendo una demostración independiente.
- Verificados health, menú real HTTP 200, permisos globales de las categorías, columna nueva y 23 pruebas de configuración, checkout y autorización. Persistencia JSON verificada dentro de una transacción revertida; precios originales conservados.
- La página real de backoffice abre correctamente y solicita iniciar sesión en el navegador de verificación. La comprobación visual autenticada queda para la sesión del usuario; no se creó una sesión ni se cambiaron credenciales.

Los procesos locales deben seguir ejecutándose. Para volver a levantar el backend desde PowerShell en este directorio: `$env:NODE_ENV='test'; $env:PORT='8080'; node index.js`. Para servir el frontend ya compilado, ejecutar `node server.js` en el storefront. No usar este build con URL localhost para publicar la web.

## Publicación pendiente

No se han publicado servicios ni elegido precios del negocio. La columna ya existe en la base remota, pero la web pública y su API continúan con su código publicado anterior.

1. Migración aplicada: `20261016120000_add_category_base_prices`, columna nullable sin importes históricos inventados.
2. Publicar backend y storefront de forma coordinada. El backend exige la columna al cargar el menú; un cliente anterior que envíe precios calculados con el 80 % será rechazado si no coinciden con los configurados.
3. Configurar los precios reales desde cada categoría; mientras estén vacíos, los tamaños no aparecerán en el armado. El resto de la carta no cambia sus precios.
4. Verificar el guardado/recarga contra la base real y activar `categoryBasePricingAnnouncementDraft` (ES/EN/IT/FR/PT) cuando la función esté disponible.

La revisión sintética se inicia con `node scripts/category-pricing-preview.cjs` en el storefront. La aplicación real de localhost:3000 ya usa el backend local actualizado; la compilación separada `build-category-pricing` apunta a la API pública y no se está sirviendo.

Fuera de esta entrega: compactación móvil, retorno automático a familias al añadir ingredientes y persistencia del borrador del minijuego.
