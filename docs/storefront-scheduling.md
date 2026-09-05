# Storefront abierto fuera del horario de servicio

El horario de cocina no cierra la navegación ni la selección de tienda para delivery. Los cierres explícitos siguen dependiendo de `Store.active` y `Store.acceptingOrders`; los controles y pantallas de cierre existentes se conservan.

`GET /api/checkout/availability/:storeId` devuelve disponibilidad actual sin caché. `services/orderAvailability.js` concentra las reglas que antes calculaba el modal de StorePage: hoy y cuatro días posteriores, intervalos de 15 minutos y primeras franjas 30 minutos después de la apertura. No se introduce una antelación general de 30 minutos desde la compra. Las fechas se calculan en `TIMEZONE` (por defecto `Europe/Madrid`), con turnos de medianoche y cambios DST. Los días sin turno no reciben franjas inventadas. Para tiendas sin ningún horario configurado se conserva la política anterior: pedidos inmediatos permitidos y programación de 14:30 a 23:30.

El modal existente consume fechas y horas del servidor. Al continuar al pago se vuelve a consultar la disponibilidad; fuera de servicio se exige seleccionar una franja. Cancelar devuelve al carrito sin enviar el pedido. La programación se conserva como instante ISO en el borrador, el payload y `Sale.customerData.scheduledFor`, y aparece en el resumen del carrito, la confirmación de efectivo y Stripe. Una selección caducada exige elegir otra franja y no se convierte silenciosamente en un pedido inmediato. Si no quedan franjas o no se puede verificar la disponibilidad, no se inicia el pago.

`POST /api/checkout/session` valida la programación con datos actuales y vuelve a comprobarla dentro de la transacción antes de crear el pedido, tanto para efectivo como para Stripe. Rechaza cierres manuales, fechas inválidas y pedidos inmediatos fuera de servicio con errores 409 y disponibilidad actualizada. Esto cubre cambios de horario durante el checkout local y peticiones directas que intenten omitir la fecha.

## Límite de Stripe Checkout alojado

La arquitectura existente usa cobro automático en Stripe y no configura `expires_at`, invalidación de sesiones al cambiar horarios ni captura manual. Una sesión de Stripe creada válidamente puede continuar abierta cuando posteriormente cambia el horario o se cierra la tienda. Esta implementación no garantiza impedir ese cobro ya fuera del checkout local y no rechaza un webhook después de cobrar al cliente. Resolver ese caso requiere un cambio específico en la gestión de sesiones/pagos; se mantiene fuera del alcance acordado, sin modificar la captura ni los medios de pago actuales.

## Verificación

- Backend: `npm test`, incluidas pruebas de disponibilidad, validación HTTP sin crear venta/cobro, cierres manuales, cambio de horario, fechas inválidas, días sin turnos, medianoche, DST y presentación de programación en Stripe.
- Storefront: `CI=true node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand`; pruebas del modal, bloqueo al cancelar, ausencia de franjas, cambios de horario, flujo inmediato, recuperación del borrador y cierre manual.
- Compilación: `npm run build` en volta-storefront.

No requiere migraciones ni cambia contratos de los pedidos ya creados. No se ha desplegado.
