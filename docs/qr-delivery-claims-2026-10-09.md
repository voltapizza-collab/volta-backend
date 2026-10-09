## Aclaración de repetición

Un beneficio por teléfono normalizado y campaña, sin reinicio al canjear o caducar. Un teléfono nuevo para esa campaña entra por el primer envío, aunque ya exista como cliente. La pantalla indica «Ya te enviamos tu envío gratis» cuando el proveedor confirmó entrega; no promete otro cupón al consumirlo. La nota publicada `qr-short-codes-single-sms-2026-10` ya describe el límite por teléfono/campaña. Luigi deja para más tarde la prueba de recepción en otro móvil; no se realiza otro SMS real.

Publicación verificada: storefront `90f6999c-e33c-4abc-af80-ff3e15c8da7d` y backend `721d7a21-7470-4b96-8add-0540bfcbf49c`, ambos SUCCESS. 40 pruebas backend y 24 frontend correctas; revisión visual a 375 px sin desbordamiento; bundle/CSS públicos y health 200 verificados.

## Confirmación del SMS — 9 de octubre de 2026

La API indica `delivery.sentNow` para diferenciar un envío de esta petición de un SMS anterior. `sent` sigue significando aceptación por el proveedor, no entrega al teléfono. La página distingue cola, entrega confirmada, solicitud anterior, fallo y pendiente. Conserva un único intento por teléfono/campaña. Tarjeta de fondo gris claro y texto gris oscuro, con ancho incluido el relleno para móvil.

Diagnóstico de producción (solo lectura): el único cupón individual existente tenía entrega confirmada por el proveedor a las 11:14 de Madrid; la repetición reutilizaba ese estado y daba una confirmación ambigua. No se enviaron SMS reales de prueba.

# Tokens QR: envío gratis por SMS

## Estado actual: códigos compactos y un solo SMS

Los nuevos cupones hijos usan `VOL-DF` y 10 caracteres aleatorios criptográficos (16 caracteres en total), con comprobación de colisión y clave única. La revisión de los otros generadores y del inventario confirmó códigos automáticos de 12 caracteres; los cupones QR de envío gratis eran la excepción de 38. Los códigos ya enviados no se renumeran para conservar sus enlaces. El webhook admite los formatos de 12, 16 y 38 caracteres. El recuadro de códigos anteriores usa tipografía compacta.

Cada teléfono/campaña tiene un único intento automático de SMS. La marca duradera `qrSmsAttemptAt`, escrita bajo bloqueo antes del envío, impide nuevos intentos aunque el cliente mande `resend=true`, refresque o espere hasta otro día. Esto prioriza no duplicar SMS; si un proceso se interrumpe tras reservar el intento, la pizzería debe revisar el resultado, no se reenvía automáticamente.

Una respuesta al formulario cierra el modal y muestra el resultado fuera de él: enviado, pendiente o fallo, sin botón de reenvío ni nueva compra forzada. Las campañas detenidas no ofrecen recuperar SMS. Los errores de validación permiten corregir los datos. El alta del cliente y el cupón permanecen aunque el SMS falle. Estas reglas sustituyen las instrucciones históricas de recuperación/reenvío que se documentan más abajo.

Pruebas del paquete final: 40 casos de backend, incluyendo MySQL real aislado, intento concurrente único, rechazo del reenvío al día siguiente incluso tras fallo y webhook de ambos formatos; 19 pruebas de interfaz y navegación. No se enviaron SMS reales durante las pruebas.


Implementación local del 9 de octubre de 2026, autorizada tras acordar la ampliación de Tokens QR. Pendiente de publicación. No se han aplicado cambios a la base de producción ni enviado SMS reales.

## Funcionamiento

- Tokens QR conserva el descuento fijo, su QR, tiendas, fechas y acciones. Añade «Envío gratis · recibir cupón por SMS» y validez individual de 15, 20 o 30 días (30 por defecto).
- El QR sigue siendo `/c/:code`. Los tokens antiguos continúan hacia la compra. El nuevo tipo abre el modal de reclamación existente, adaptado para pedir nombre y teléfono y solicitar expresamente el SMS. No pide dirección ni código postal.
- La campaña puede tener fin vacío. Su vigencia controla nuevas reclamaciones. Cada beneficio cuenta días de 24 horas desde su reclamación, almacenados como instantes; la fecha se presenta en Europe/Madrid. No se utiliza el reloj local reconstruido de `nowInTZ` para emitir estos beneficios.
- Un teléfono español normalizado recibe un cupón por campaña, con un uso. Volver a reclamar recupera el mismo cupón; no renueva caducidad. Un cupón utilizado, desactivado o caducado no se reemplaza automáticamente.
- El SMS incluye el envío gratis, un uso, la fecha de caducidad y el enlace privado de compra. El código incorpora 128 bits aleatorios, y no se devuelve al formulario público ni a quien solo introduzca un teléfono. El mensaje conserva el límite de un segmento del proveedor.
- No se crea una cuenta ni una contraseña. La posesión del enlace SMS y la coincidencia del teléfono en checkout son las comprobaciones aplicadas; no constituyen identificación civil ni impiden compartir voluntariamente el enlace y el teléfono.
- Detener la campaña no invalida los cupones emitidos ni impide su recuperación. Una campaña con reclamaciones no puede eliminarse; la acción la detiene y conserva el historial.

## Reutilización y datos

La campaña sigue siendo `Coupon`, con `campaign=CHANNEL_SHIFT` y `meta.qrBenefit=DELIVERY_FREE`. Esa fila no es canjeable. Cada beneficio es otro `Coupon` de envío gratis, reservado al cliente, con `sourceQrId`, `claimPhone`, límite uno y caducidad propia. No hay otro motor de descuentos ni un módulo de campañas paralelo.

Migración: `20261009150000_add_qr_delivery_claims`.

- `Coupon.sourceQrId`, relación al token con borrado restringido.
- `Coupon.claimPhone`, clave única junto a `sourceQrId` para impedir emisiones duplicadas.
- `Coupon.qrViewCount`, contador de aperturas del enlace.
- `Customer.marketingSuppressed`, falso para registros anteriores; verdadero para clientes nuevos creados por esta reclamación. Las campañas SMS, lotes privados y promociones directas excluyen estos perfiles. No se usa `isRestricted` como sustituto de consentimiento.
- `CouponClaimThrottle`, límites compartidos entre instancias, con claves hash y caducidad; no conserva IP en claro.

La reclamación bloquea la fila del token en una transacción y emite o recupera el cupón. La entrega del SMS ocurre después de confirmar la transacción. Reintentos y callbacks actualizan metadatos bajo bloqueo para conservar el plazo de reenvío y evitar retroceder de una entrega final a un estado pendiente.

Se permiten 30 solicitudes por IP en 15 minutos y 5 por teléfono en una hora; el reenvío tiene una espera mínima de 120 segundos. Los intentos caducados con más de un día se limpian al procesar nuevas solicitudes. Un resultado ambiguo de transporte puede terminar en un segundo SMS con el mismo cupón; nunca se promete entrega exactamente una vez.

## Canje y delivery

Se reutilizan `evaluateCoupon`, `CouponReservation`, los bloqueos de checkout, el registro `CouponRedemption`, la conciliación Stripe y el consumo en efectivo. El teléfono presentado y el cliente resuelto deben coincidir con el teléfono destinatario. Los IDs de tienda son estrictos: compartir código postal no amplía el ámbito.

El beneficio conserva las reglas actuales: pedido mínimo, tarifa y cobertura, un cupón por pedido, disponibilidad, liquidaciones y carritos mixtos. Los portes adicionales de liquidación no se bonifican; no se ha cambiado la política de reparto ni su revisión manual. Detener el token no cambia pagos ya reservados ni la política de devoluciones de cupones.

## SMS y privacidad

Se reutilizan Telnyx, `privateCouponDelivery`, el saldo SMS, la reserva/reembolso de créditos y los enlaces de canje. El webhook reconoce tanto códigos `VOL-DF` antiguos como los nuevos. Si falta configuración o saldo, el cupón queda guardado y el consumidor puede reintentar su entrega. No hay una cola nueva de reintentos automáticos ni un envío masivo de recuperación.

El modal separa la solicitud de esta promoción de futuras comunicaciones comerciales. Registra la versión de condiciones con la reclamación. Los registros nuevos quedan excluidos del marketing; la reclamación no modifica las preferencias históricas de clientes existentes. Cualquier futura habilitación de publicidad debe basarse en una autorización independiente, no en el escaneo.

## Medición

Tokens QR muestra aperturas del enlace, cupones emitidos, canjes, importe de portes bonificados y SMS fallidos/omitidos. Las aperturas pueden incluir recargas, previsualizaciones y robots: no son personas únicas ni prueba de escaneo físico. Los portes bonificados son descuento concedido, no el coste logístico real. No se etiqueta automáticamente un canje como cliente migrado de un marketplace.

La relación token → cupón → canje → pedido permite análisis posteriores. Cohortes de recompra, atribución verificada a marketplaces y costes logísticos reales no se incorporan en esta ampliación.

## Verificación y publicación

La migración se ejecutó sobre MySQL 8.0 local aislado: esquema anterior, migración y comparación con el esquema final sin diferencias. Cliente Prisma de prueba generado por separado para no sustituir la DLL de un servidor en uso.

Resultado final: 101 pruebas de backend y 25 de storefront correctas, sin fallos ni omisiones en las baterías ejecutadas.

Pruebas: variantes de teléfono, fechas 15/20/30 y cambio horario, tipo antiguo, imposibilidad de gastar el token padre, privacidad de respuestas, 12 reclamaciones concurrentes con una emisión, clave única real, reenvío tras detener campaña, caducidad sin renovación, eliminación protegida, fallo de SMS por servicio desactivado, callbacks, límites simultáneos, tienda con mismo CP, titularidad, canje en efectivo y segundo canje rechazado. Se conserva la batería previa de reservas y pagos con proveedores simulados.

Compilación de producción del storefront completada correctamente (`main.fc65d9e7.js`).

El recorrido de reclamación y confirmación se revisó con navegador a 320 y 393 píxeles, sin desbordamiento horizontal ni errores de JavaScript. Los mensajes de esa revisión fueron simulados.

Antes de ponerlo a disposición: aplicar la migración y generar Prisma Client, publicar backend y storefront juntos, verificar el número real de proxies mediante la configuración existente `TRUST_PROXY_HOPS`, habilitar el servicio de cupones y saldo SMS, y comprobar un SMS controlado con autorización del destinatario. Activar entonces `qrDeliveryClaimAnnouncementDraft` con fechas reales. El borrador ES/EN/IT/FR/PT permanece fuera del feed hasta esa publicación.

## Corrección del entorno local — 9 de octubre de 2026

El backend de `localhost:8080` usa la base de Railway configurada en `.env`. El primer intento de crear `DELIVERY_FREE_PASS` guardó el token, pero respondió 500 al consultar estadísticas con un cliente Prisma anterior a esta función. También faltaba la migración en esa base.

Se respaldaron y verificaron las tablas `Customer` y `Coupon` en `C:/Users/Luigi/VoltaBackups/qr-delivery-2026-10-09/`, se aplicó la única migración pendiente (`20261009150000_add_qr_delivery_claims`), se generó el cliente Prisma del backend y se reinició el servidor local. Se conservó el token existente, sin duplicarlo. Esto actualiza la base compartida y el proceso local; no constituye un despliegue del código del servidor público.

La creación y la preparación de su respuesta ahora comparten una transacción: un error en las estadísticas revierte la creación. La prueba de regresión comprueba la reversión y el reintento con el mismo código. Las 18 pruebas ejecutadas de creación, ciclo completo, enlaces y métricas pasan sin omisiones; los límites de peticiones del MySQL aislado se limpian entre ejecuciones.

Verificado con la base configurada: el listado devuelve 200 con `DELIVERY_FREE_PASS` activo y el token fijo anterior. El endpoint público del servidor local devuelve 200 y `mode: claim` para el pase existente. No se enviaron SMS reales.


## Publicación del recorrido QR → SMS

El escaneo real usaba `https://voltapizza.com/c/DELIVERY_FREE_PASS`, pero el servidor público todavía respondía con un enlace directo a la tienda. La comprobación de localhost no validaba ese despliegue. Se prepararon paquetes separados en `output/qr-delivery-release-2026-10-09`, basados exactamente en los commits públicos: backend `b6177dbc52ecdb7fcb01109d8dd5734e9865859f`, storefront `4e1188221d67a90fc50c23d9c7f02288c8d2cf50`. Solo incluyen esta función y sus dependencias; los cambios locales de landing, onboarding y códigos de pedido quedan fuera.

En Railway el límite QR usa `X-Real-IP` validado como dirección IP, únicamente dentro de un despliegue Railway (`RAILWAY_DEPLOYMENT_ID`). En local usa `req.ip`. Así las reclamaciones no comparten el límite de la IP del proxy. Contrato de ingreso: https://docs.railway.com/networking/public-networking/specs-and-limits . No se cambia la confianza global de Express.

Pruebas del paquete: 91 casos de backend, 11 de MySQL real aislado, 25 de interfaz y compilación correcta. Tras ajustar la IP de ingreso se repitieron los 9 casos de QR e integración, todos correctos. El servicio SMS de MyCrushPizza estaba habilitado y tenía saldo; no se enviaron mensajes reales para esta verificación.

Ambos despliegues públicos finalizaron correctamente: storefront `12767102-143c-4743-a5a0-afbfffb57b1b` (`main.cf75ac46.js`), backend `a48ab070-a7f2-41c2-857e-26d13dd51998`. El endpoint público de reclamación rechaza un cuerpo vacío con `400 invalid_phone`; el token fijo `VOLTA` mantiene su redirección. Las ramas de GitHub no se modificaron; los cambios QR deben conservarse en el siguiente despliegue desde GitHub.

Durante la comprobación, el backoffice recibió eliminaciones de los tokens 482 y 483 (DELETE 200). Ya no quedaba `DELIVERY_FREE_PASS`; su enlace devolvió 404. Se solicitó aclaración al usuario antes de restaurar una campaña eliminada.


## Resultados de captación — 9 de octubre de 2026

La tabla destaca dos métricas: aperturas del QR (etiqueta escaneos/visitas, incluye repeticiones y no identifica personas únicas) y clientes nuevos incorporados al negocio. El detalle muestra clientes existentes, cupones emitidos, último SMS aceptado/entregado y usos. No se suman reenvíos como nuevos clientes ni como cupones adicionales.

Cada primera reclamación guarda en el cupón `meta.qrCustomerCreated` y `meta.qrCustomerId` dentro de la transacción que busca o crea al cliente. Se compara el teléfono completo normalizado, admitiendo espacios, guiones, +34 y 0034 en fichas antiguas. Un bloqueo por negocio evita duplicados entre campañas QR simultáneas; este cambio no rediseña los demás canales de alta. Una ficha existente conserva sus datos y preferencias. Las altas quedan guardadas antes de intentar el SMS, incluso si el envío falla. No requiere migración.

Los cupones anteriores sin esta marca se muestran como registros sin clasificación histórica, sin inventar altas nuevas. Al comprobar la base compartida antes de esta entrega no había cupones hijos QR, por lo que no se necesitó rellenar datos históricos.

Verificación: MySQL real aislado cubre alta nueva, reutilización de teléfono formateado, fallo SMS sin perder el alta, recuperación sin doble cómputo y dos campañas simultáneas con un solo cliente. Se verificó el componente con datos simulados en navegador: cifras alineadas, detalle desplegable y página sin desbordamiento horizontal. Paquete de publicación: `output/qr-delivery-metrics-2026-10-09`, basado en la entrega QR anterior. La nota `qrCustomerMetricsAnnouncement` incluye ES/EN/IT/FR/PT y se publica con el backend después del storefront.

Publicación verificada: storefront `36252109-e500-4550-9097-7e88a4037d04` (`main.1ea499de.js`) y backend `afafd7cb-5bf8-466d-ad48-548c2d2a1b55`, ambos SUCCESS. Se verificaron los textos y la clase de contención en el bundle público; el QR fijo responde 200 tanto local como públicamente. La batería final del paquete pasó 20 pruebas de backend; la interfaz pasó 6. No se enviaron SMS reales ni se restauraron campañas eliminadas.

Entrega final publicada y verificada: storefront `868a7b04-1a20-420f-8438-c9f3d14e70fb` (`main.5cd2faae.js`) y backend `724efbf0-06db-48f6-ade2-6203f9418be3`, ambos SUCCESS. El enlace del cupón largo mostrado por el usuario sigue resolviendo con 200, igual que el QR fijo. El navegador de prueba confirmó que el modal desaparece y solo queda la confirmación; el bundle público ya no contiene el botón Reenviar SMS. El servidor local y su compilación también quedaron actualizados.
