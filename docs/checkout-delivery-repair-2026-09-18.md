# Reparto variable y cupones de envío — reparación local

**Reanudación del 24 de septiembre:** comprobaciones locales y compilación completadas; véase [estado recuperado, evidencias y siguientes pasos](reanudacion-auditoria-2026-09-24.md). Sunmi físico y publicación continúan pendientes.

18 de septiembre de 2026. Continuación del bloque de auditoría. Sin despliegue de producción, cobros reales ni escrituras en la base compartida. El Sunmi instalado sigue pendiente de actualización y prueba física.

## Problemas corregidos

1. El checkout recibía la distancia del navegador y la usaba para calcular la tarifa variable. También podía usar directamente el importe de envío enviado por el cliente cuando faltaba distancia. Ahora vuelve a consultar la dirección en el servidor y calcula el coste con la ruta hasta la tienda del pedido. Las coordenadas, distancia e importe del navegador no son la fuente del precio.
2. Una distancia redondeada podía cruzar un tramo de facturación. Se conserva la precisión de la distancia de ruta antes de aplicar el redondeo por kilómetros de la tarifa.
3. La lectura de la matriz de rutas podía tratar una respuesta sin ruta como válida por la ausencia de un estado de error. Ahora exige `ROUTE_EXISTS`, ausencia de error y una distancia no negativa. Los índices se comprueban contra las tiendas solicitadas. El formato se contrastó con la [documentación oficial de Google Routes](https://developers.google.com/maps/documentation/routes/compute_route_matrix). Las peticiones a mapas tienen tiempo máximo de espera y los errores de ruta no registran la petición ni las credenciales.
4. Con envío gratuito, el servidor restaba el cupón de los productos, limitaba ese subtotal a cero y añadía después el envío. Si el envío superaba los productos, el total era incorrecto. Ahora limita a cero el total **después** de sumar productos y envío y restar descuentos. La prueba con productos de 9,99 € y envío de 10,50 € confirma un total de 9,99 € al aplicar el cupón, tanto en efectivo como con tarjeta simulada.

## Comportamiento de confirmación

Si la tarifa calculada no coincide con la vista por el cliente, se devuelve 409 `delivery_price_changed` con la tarifa actual. No se crea la venta ni se inicia el pago. El cliente conserva su carrito, ve el nuevo total y debe volver a confirmar. No hay reintento automático de cobro.

Una dirección que la ruta del servidor sitúa fuera del radio configurado se rechaza. La pantalla ofrece volver a revisar la dirección. Antes de crear la venta, la transacción vuelve a comprobar que la tienda permite reparto y que su ubicación y la política de tarifas/cobertura no cambiaron desde la consulta.

Las llamadas a mapas ocurren antes de abrir la transacción de venta. Recogida y tarifa fija no requieren esas llamadas. Esta reparación no introduce comprobación nueva de cobertura geográfica para la tarifa fija.

## Política de revisión manual conservada

Al comenzar se pidió a Luigi elegir entre bloquear el pago sin ruta o permitir tarifa base y confirmación manual. Al revisar el código se encontró una regla ya existente en `buildManualDeliveryResolution` y sus pruebas: continuar con tarifa base cuando no se puede medir la distancia. Se conserva esa alternativa; no consta una nueva elección del usuario.

En checkout, si no se puede verificar la dirección, faltan coordenadas de la tienda o no se obtiene una ruta, se calcula **la tarifa base guardada en el servidor**. Se informa al cliente y se exige una nueva confirmación, incluso si la cifra coincide con la que ya veía. Una dirección vacía o una ruta conocida fuera de cobertura no pueden acogerse a esta alternativa.

El pedido guarda `customerData.delivery.manualReviewRequired`, sin migrar el esquema. `formatSale` lo entrega al POS como `deliveryReviewRequired`. Se muestra «Revisar reparto · tarifa base» en la cola, un aviso en el ticket abierto y una advertencia en los contenidos para impresión Windows/Sunmi. La prueba del contenido impreso **no sustituye** la impresión física.

La carta inicial puede utilizar una estimación de distancia existente; checkout solo considera verificada una ruta confirmada y puede pasar a revisión manual si no la obtiene. Ese cambio se muestra antes de aceptar el pedido. Esta política permite pedidos con cobertura pendiente de comprobación humana; no debe describirse como una garantía de que todas las direcciones aceptadas estén dentro de cobertura. Sigue disponible la alternativa consultada de bloquear esos pedidos si Luigi prefiere cambiar la regla.

## Pruebas

- [Auditoría HTTP/MySQL](checkout-delivery-audit.json): 28 escenarios, efectivo y tarjeta, tarifa válida, importe cero manipulado, distancia falsificada, frontera entre kilómetros, fuera de radio, alternativa manual, dirección vacía, política modificada antes de la venta, tienda que desactiva el reparto, tarifa fija, recogida y cupón de envío superior al importe de productos. Resultado completo, 43 tablas restauradas. Las ventas válidas se revierten antes de contactar a Stripe.
- Geocodificador y matriz de rutas simulados; no se consultaron direcciones reales ni se usaron servicios de mapas externos en las pruebas. Tampoco se enviaron mensajes.
- 270 pruebas satisfactorias de backend; la prueba adicional MySQL de cupones también pasó. Incluye regresión de reservas, consumo, liberación y efectivo/tarjeta simulada.
- 194 pruebas de frontend satisfactorias en la suite completa; se añadió después la comprobación del acceso para revisar una dirección fuera de cobertura y se repitieron las pruebas afectadas. El aviso de revisión manual se comprueba en la vista del ticket y en ambos formatos de impresión.
- Se repitieron los 36 escenarios de precios/promociones y los 28 de disponibilidad de ingredientes: cero hallazgos y datos de copia restaurados.

La nota `checkoutDeliveryAnnouncementDraft` incorpora ES/EN/IT/FR/PT y sigue fuera del feed. Publicar únicamente con backend, storefront y POS actualizados. No se ha ampliado el catálogo ni decidido la composición de las fichas de ingredientes pendientes.
