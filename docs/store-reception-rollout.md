# Punto 2: habilitación y recepción de pedidos

Implementación local del 4 de octubre de 2026. Pendiente de despliegue conjunto con los accesos del punto 1. No se han abierto tiendas reales ni enviado SMS durante la validación.

## Recorrido del administrador

1. Completar la ubicación y habilitar la tienda en **Tiendas**.
2. Configurar horarios, recogida/delivery y al menos un producto con precio, activo en esa tienda y con sus ingredientes disponibles.
3. Revisar la nueva columna **Pedidos online**. Indica lo que falta; no hay que buscar un campo llamado «Aceptación de pedidos».
4. Pulsar **Abrir pedidos**. El servidor vuelve a comprobar los requisitos. Si conserva una pausa o está fuera de horario, solo se ofrecerán los pedidos programados permitidos por sus horarios.
5. **Cerrar pedidos** detiene nuevas compras inmediatas y programadas. Los pedidos existentes conservan su estado.

**Habilitada** significa que la tienda está disponible como establecimiento. **Recibiendo pedidos**, **Pedidos cerrados**, **En pausa** y **Fuera de horario** explican el estado comercial. El POS utiliza la misma apertura/cierre y conserva su control separado de pausa.

Guardar una dirección no abre los pedidos. Deshabilitar la tienda cierra también la recepción; habilitarla de nuevo exige una apertura explícita. Si se eliminan coordenadas de una tienda abierta, se deshabilita y cierra la recepción como medida coherente con el bloqueo existente de ubicación; no cambia la pausa.

## Comprobaciones y límites

El nuevo endpoint privado `GET/PATCH /api/stores/:id/order-reception` comprueba tienda y negocio habilitados, coordenadas válidas, una forma de entrega, horarios configurados, un producto vendible y un medio de cobro soportado por el checkout. Tarjeta requiere la configuración Stripe del servidor; efectivo requiere autorización para esa tienda en las políticas del negocio. Esto comprueba configuración, no hace un cobro de prueba ni verifica el estado remoto de Stripe.

No se exige un pago del POS/SMS inexistente: corresponde al futuro punto 4. Tampoco se afirma haber verificado instalación física, impresión, cuenta bancaria o primer pedido real.

Las comprobaciones de preparación se hacen al consultar el estado y al abrir. No se cierran automáticamente tiendas históricas por desplegar esta versión. Las comprobaciones existentes del checkout siguen validando horarios, productos, ingredientes, precios y entrega en cada compra. Las tiendas históricas abiertas sin horarios conservan su compatibilidad actual; su próxima apertura explícita sí requiere configurarlos.

La apertura cambia solo `acceptingOrders`; nunca borra `operationsPaused`. La escritura se serializa con los cambios de la fila de tienda. El cierre funciona aunque la carta esté incompleta. No existe apertura alternativa mediante el PATCH general; las tiendas nuevas se crean con recepción cerrada.

Las rutas nuevas exigen sesión y pertenencia al negocio/tienda tanto en el backoffice como en el POS web y la pasarela del POS nativo. El estado del backoffice se refresca al cerrar formularios de configuración, al recuperar foco y cada 30 segundos. El POS conserva su refresco cada 15 segundos.

Los avisos SMS existentes de apertura/cierre se vinculan al cambio de recepción, respetando las preferencias y créditos del negocio. Habilitar sin abrir no genera un aviso de apertura. La nota `storeReceptionAnnouncementDraft`, traducida a cinco idiomas, permanece fuera del feed hasta el despliegue coordinado.

## Validación

69 pruebas de backend aprobadas: apertura, bloqueos, rutas privadas, permisos POS, horarios y cambios de hora, pausa, cierre con programación, menú, entrega, checkout y notificaciones. 29 pruebas de frontend aprobadas: nueva columna, errores y reintentos, POS, inicio de sesión, inventario, mensajes públicos y pedidos programados. Compilación de producción correcta.

No se ha realizado una prueba contra la base de datos de producción ni una prueba física del Sunmi. Antes de publicar: completar los requisitos de [accesos por negocio](web-access-rollout.md), desplegar backend y frontend coordinadamente y comprobar en una tienda de pruebas habilitación → preparación → apertura → pausa → cierre. El POS web/nativo debe cargar el nuevo frontend para usar el nuevo control.
