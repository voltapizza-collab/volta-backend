# Número corto de pedido y selección de tienda

Implementación local del 8 de octubre de 2026. Sin despliegue, migraciones, cobros ni envíos reales de SMS.

## Comunicaciones

`services/orderDisplayCode.js` reproduce la regla del POS: un código `WEB-` con 32 dígitos hexadecimales y un ID entero positivo seguro se muestra como `WEB-<id>`. Los códigos históricos y la ausencia de un ID válido conservan el código original. Las pruebas verifican el contrato y, con ambos repositorios presentes, la paridad con el helper del POS.

Se aplica a los SMS de pago y recogida/reparto, al aviso SMS de Boost, a los títulos de alertas de pedidos sin aceptar/venta sobre ticket promedio/Boost y a los nombres visibles en el checkout de Stripe. El seguimiento añade `displayCode` a su respuesta y lo usa en sus tres referencias visibles al pedido, incluido el texto de recogida. `code`, los enlaces, las consultas, los metadatos de pagos, los tags del proveedor y las referencias del registro de créditos conservan el código completo.

El SMS de chat mantiene su enlace completo: no contenía otra etiqueta de pedido que acortar. Reservas y devoluciones usan la estimación del texto final. Se incorporan dependencias inyectables al transporte de los SMS de pedido, siguiendo el patrón de las notificaciones internas, para comprobar reservas, fallos y devoluciones sin enviar mensajes.

## Medición de mensajes completos

Ejemplos ficticios con ID 775, token `WEB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` y dominio `https://voltapizza.com`, calculados con `estimateSmsParts`.

| Aviso | Codificación | Longitud antes → después | Segmentos estimados antes → después |
| --- | --- | --- | --- |
| Pago, MyCrushPizza y Ana | GSM-7 | 156 → 127 | 1 → 1 |
| Recogida, MyCrushPizza y Plaza de Ary | GSM-7 | 93 → 64 | 1 → 1 |
| Reparto, MyCrushPizza y Plaza de Ary | GSM-7 | 87 → 58 | 1 → 1 |
| Recogida, Pizzería y Plaza de Ary | UCS-2 | 89 → 60 | 2 → 1 |
| Chat, MyCrushPizza | GSM-7 | 128 → 128 | 1 → 1 |

Pago antes:

```text
MyCrushPizza: pago OK Ana. Pedido WEB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA. Seguimiento: https://voltapizza.com/seguimiento/WEB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Pago después:

```text
MyCrushPizza: pago OK Ana. Pedido WEB-775. Seguimiento: https://voltapizza.com/seguimiento/WEB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Recogida antes:

```text
Pizzería: pedido WEB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA listo para recoger en Plaza de Ary.
```

Recogida después:

```text
Pizzería: pedido WEB-775 listo para recoger en Plaza de Ary.
```

Reparto antes:

```text
MyCrushPizza: pedido WEB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA en camino desde Plaza de Ary.
```

Reparto después:

```text
MyCrushPizza: pedido WEB-775 en camino desde Plaza de Ary.
```

Chat, igual antes y después:

```text
MyCrushPizza: Tu pizza esta lista. Responde: https://voltapizza.com/seguimiento/WEB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?chat=1#chat
```

Las pruebas incluyen nombres largos y límites GSM-7/UCS-2: reducir 29 caracteres no implica siempre reducir un segmento. La longitud procede del estimador existente. El transporte actual exige un solo segmento: un mensaje que supera ese límite se rechaza y se reembolsa, no se envía como multipart. Se conserva esa política y no se recorta información para sortearla.

## Por qué conservar el código largo

`routes/checkout.js` genera 16 bytes aleatorios (128 bits) y comprueba la unicidad de `Sale.code`. `Sale.id` ya es el identificador numérico interno. El código público también funciona como credencial por posesión: los endpoints de `routes/sales.js` consultan el pedido y permiten responder al chat a quien conoce el código, sin una sesión de cliente adicional. Sustituirlo por `WEB-775` haría esos accesos predecibles. Las pruebas HTTP verifican que el código completo sigue funcionando y que el número visible abreviado no permite consultar ni escribir mensajes.

Recomendación: conservar la numeración interna y el token actual. Como mejora posterior acotada, estudiar una ruta propia `/s/<token>` con los mismos 16 bytes codificados en base64url sin relleno (22 caracteres). En este dominio, el enlace pasaría de 71 a 47 caracteres: ahorro adicional de 24 caracteres sin reducir los 128 bits. Se puede decodificar y reconstruir el `WEB-<hex>` existente, por lo que no necesita migrar los pedidos modernos. Requiere validación canónica, distinguir mayúsculas y minúsculas en la nueva ruta, preservar `?chat=1#chat`, conservar los enlaces antiguos y usar el enlace actual para códigos históricos no compatibles. La normalización a mayúsculas de la ruta antigua no debe aplicarse al token base64url. Alcance pequeño a medio: ruta, generador de enlaces y pruebas de compatibilidad; no implementado en esta entrega. No se recomienda un acortador externo ni truncar el token.

## Selección de tienda

- El Store Gate, tras cargar el partner, abre directamente la única tienda elegible. Una tienda solo de reparto pasa directamente a la comprobación de dirección/cobertura; no se fuerza recogida.
- Con varias ciudades, la recogida comienza por elegir ciudad, sin ciudad preseleccionada ni lista redundante debajo. Una ciudad con una tienda entra directamente. Una ciudad con varias muestra sus nombres y direcciones dentro del modal existente.
- Con una ciudad y varias tiendas se omite el selector de ciudad. Las tiendas sin ciudad siguen accesibles mediante «Otras tiendas» si hay otros grupos.
- Se conservan las reglas de `active`, `acceptingOrders` y métodos admitidos. Pausa y horario cerrado no excluyen una tienda que permite pedidos programados.
- Elegir recogida elimina el contexto anterior de reparto. Se conservan las rutas y la gestión existente de carritos por tienda; no se migra ni vacía el carrito. Cambiar de método o tienda sigue disponible en la carta.
- Cerrar el modal no lo reabre automáticamente. La redirección automática a una única tienda desde «Cambiar a recogida» reemplaza la entrada intermedia del historial para evitar un bucle al volver atrás.

## Comprobaciones

- Backend: 58 pruebas correctas entre `orderNotifications`, `trackingNotifications`, `trackingAlerts`, `stripeCheckout`, `telnyx` y `backofficeNotifications`. Transporte y pagos simulados; seguimiento/chat probados por HTTP contra un servidor local con datos ficticios.
- Storefront: 21 pruebas correctas entre selección de ciudad/tienda, estados del partner, presentación del POS y reparto/carrito.
- Compilación de producción comprobada. El validador de ingredientes previo conserva las 3.728 fichas. Advertencia existente: los datos de Browserslist están desactualizados.
- Navegador Edge sin interfaz, con API simulada y peticiones externas interceptadas: 1440×1000 y 390×844. Entrada por Ourense/Vigo, navegación atrás, ciudad con varias tiendas, una ciudad, Store Gate con una tienda, modal cerrado, número corto en seguimiento, ausencia de errores de página y desbordamiento horizontal. Capturas revisadas en `../../output/order-code-store-selection/`; script reproducible `../../tmp/qa-order-code-store-selection.cjs`.

La nota `orderCommunicationAndStoreSelectionAnnouncementDraft` incluye ES/EN/IT/FR/PT y está fuera del feed. Publicarla solo cuando backend y storefront estén desplegados y comprobados conjuntamente. No se anuncia un acortamiento de los enlaces ni un ahorro fijo de créditos.

## Ampliación: Movimientos y otras pantallas

La revisión adicional aplica el mismo helper del POS a la columna Código de Movimientos, al encabezado de «Ver ticket» y al detalle de pedido de My Orders. La búsqueda de Movimientos acepta el código corto, su parte numérica y el código completo, además de los campos de cliente existentes. Sigue filtrando las ventas cargadas por el resumen de facturación; no añade una búsqueda global de todo el historial.

También se corrigen las referencias de pagos recibidos en Finanzas, sus CSV individuales y en lote, y los títulos de las opciones y del resumen de «Repetir pedido». Las referencias de facturas y liquidaciones no son números de pedido y conservan su formato. La página pública de valoración recibe `displayCode` calculado en backend y mantiene `orderCode` como referencia original, con compatibilidad para respuestas anteriores.

La búsqueda de usos en `volta-storefront/src` y en rutas y servicios del backend confirma que el POS y sus impresoras, el seguimiento, los avisos SMS y las descripciones de pago ya tenían la presentación abreviada. Se conservan los códigos completos en enlaces, consultas, metadatos, recibos para repetir pedidos y registros de transporte; los códigos de clientes y cupones tienen otra finalidad. No se modifican pedidos almacenados. Los códigos históricos conservan su formato y los pedidos sin ID válido conservan el código completo.

Validación de esta ampliación: 28 pruebas de backend (`productReviews`, `orderNotifications`, `backofficeNotifications`) y 12 de frontend (Movimientos/CSV, valoración, repetición con ingredientes retirados y POS). Se comprueban búsquedas y apertura de ticket, contenido y nombre de CSV, referencias antiguas, acceso a valoración por token y conservación del recibo de repetición. El fixture de repetición incorpora el recibo exigido por el acceso seguro existente. La nota en cinco idiomas incluye estos cambios y sigue pendiente del despliegue conjunto.

La compilación de producción con `npm run build` finalizó correctamente, incluido el validador de las 3.728 fichas de ingredientes; permanece la advertencia de Browserslist desactualizado. `git diff --check` correcto en ambos repositorios. Esta ampliación está comprobada en local; no se ha desplegado.
