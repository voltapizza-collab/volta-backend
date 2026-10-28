# Optimización POS — despliegue, 28/10/2026

Backend funcional `f0114af`, despliegue Railway `745217df-ecd1-4e13-a83f-c1ee81c61079` SUCCESS. Migración `20261028160000_pos_effect_outbox` aplicada, sin migraciones pendientes ni fallidas; `POS_OUTBOX_ENABLED=true`. APK 0.3.26/código 29 publicada y asignada a los tres POS autorizados. No hay confirmación de instalación en los dispositivos; sus últimos reportes conservan versiones anteriores.

## Cambios coordinados

- Festivos cargados: hoy y los tres días naturales siguientes, con nombre, fecha completa y distancia temporal; visibles en el resumen incluso con pedidos. El calendario anual se revalida cada 30 días. Se conserva la cobertura regional existente; no equivale a un calendario municipal completo. Ningún aviso cambia horarios o cierres.
- Clima: consulta como máximo una vez por hora por ubicación, con previsión de los tres días siguientes. Geocodificación persistente por ciudad; los fallos reintentan como máximo cada hora. Los datos meteorológicos de más de seis horas dejan de mostrarse como actuales. Las fuentes externas son Open-Meteo y Nager.Date.
- Caché persistente limitada a 24 entradas, peticiones compartidas y plazo de 10 segundos por consulta externa. El cambio de fecha se recalcula localmente cada minuto y al volver a primer plano.
- Reloj aislado, tarjetas e inventario memoizados, referencias estables cuando los datos no cambian. La cola de pedidos no espera a la presencia de visitantes. Consultas sin solapamiento por recurso y plazos de lectura de ocho segundos.
- Inventario: cambios independientes por fila; un resultado de escritura incierto exige sincronizar antes de repetir. Se elimina la preparación de columnas multimedia de la lectura periódica y se reutiliza el contexto del catálogo.
- Historial: `GET /api/myorders/summary?view=pos` devuelve páginas de 50 tickets y totales del día completo, sin analítica histórica. El cursor conserva la fecha y el identificador; el ámbito de tienda sigue siendo obligatorio.
- Android: colas acotadas e independientes para lecturas, acciones, hardware y controles OTA; las lecturas vencen también mientras esperan en cola. La comprobación de interfaz no recalcula geometría ni duplica temporizadores al recargar.
- OTA: espera hasta diez segundos a las operaciones existentes, rechazando temporalmente nuevas operaciones durante ese vaciado. No descarta impresiones ni escrituras. Conserva consentimiento, tienda, firma, hash, permiso Android y comprobaciones de seguridad; vuelve a verificar el APK antes de instalar. Caché de verificación entre intentos, recuperación con espera creciente y reporte periódico cada cinco minutos. Un error definitivo de instalación conserva el bloqueo seguro de ese APK.
- Los reportes incluyen operaciones pendientes, inicio de estado y próximo intento. `node scripts/posReleases.js fleet` consulta toda la red en páginas y agrupa por versión, estado, error y antigüedad. `status [CURSOR_DEVICE_ID]` conserva el detalle existente. Un informe antiguo no prueba que un terminal esté averiado.

## Efectos secundarios persistentes

La migración `20261028160000_pos_effect_outbox` añade `PosEffectOutbox`. Con `POS_OUTBOX_ENABLED=true`, el cambio de inventario o la finalización de un pedido se confirma en la misma transacción que sus trabajos pendientes. No se espera al proveedor SMS en la respuesta POS.

El worker se ejecuta cada cinco segundos y reclama cada trabajo mediante una actualización condicional. La finalización de pedido usa `processed=false` y claves únicas por pedido. Los cambios de ingrediente bloquean y comprueban el estado actual antes de crear el aviso.

`DONE` significa procesado o descartado justificadamente por la configuración del servicio, no entrega física confirmada del SMS. `REVIEW` significa resultado incierto o no confirmado. Un trabajo interrumpido no se vuelve a enviar automáticamente: revisar primero el proveedor y el libro de créditos. Esto evita duplicar envíos y cargos ante una respuesta ambigua. El POS diferencia «aviso en cola» de «cliente notificado».

## Activación y comprobaciones

1. Se publicaron únicamente los cambios de esta entrega; el trabajo previo ajeno sin commit se conservó en ambos repositorios.
2. Se aplicó la migración antes de desplegar el nuevo proceso. Se verificaron la tabla, sus columnas y la consulta preparada de selección del worker contra MySQL de producción.
3. Se activó `POS_OUTBOX_ENABLED=true` para el nuevo despliegue. Verificación real: salud HTTP 200, historial paginado HTTP 200, inventario HTTP 200 y acceso a otra tienda HTTP 403. Una sesión POS temporal se revocó al terminar. Un trabajo sintético de revisión de una venta inexistente pasó a DONE sin enviar mensajes; después se eliminó únicamente ese trabajo de prueba.
4. La APK 0.3.26/código 29 conserva la firma anterior. SHA-256 `20e651d60377ebe00a4b4f72da494f8e22311895a8957b64d1fb5b8ee73d5080`, 959587 bytes. Se verificaron los bytes almacenados antes de asignarla a los tres POS autorizados. No requiere desinstalar ni perder la sesión.
5. Pendiente de confirmación desde los dispositivos: versión 29 instalada, reporte reciente, impresión y fluidez física. La nueva lógica requiere llegar primero a los clientes antiguos. La falta del permiso Android o una confirmación obligatoria del sistema no se puede resolver simulando un permiso desde JavaScript. La asignación ofrece la actualización; no acredita su instalación.
6. La nota `posPerformanceAnnouncementDraft` incluye ES/EN/IT/FR/PT y exige la nueva versión del POS. Su publicación se coordina con la disponibilidad del storefront y la APK.

Para retirar una distribución, usar el procedimiento existente `withdraw`/`unassign`; no autorizar un downgrade. Para desactivar nuevos trabajos de la cola, retirar el indicador y conservar los registros existentes para reconciliación; no borrar ni reenviar trabajos `PROCESSING` o `REVIEW` sin contrastar sus resultados.

## Evidencia local

En 60 segundos simulados, misma tienda y cola vacía: renderizados de `PosApp` 68 → 12; consultas de clima 4 → 0 y calendario 4 → 0 después de la carga inicial. Las consultas operativas mantienen su frecuencia. El reloj continúa actualizándose cada segundo en su componente aislado. Un pedido aparece con la consulta de presencia retenida.

Pruebas Jest de interfaz, Node de backend con dobles de base de datos/proveedor, pruebas Java de consentimiento/cadencia/exclusión y compilación/firma Android. Prueba visual del bundle de producción en Edge a 360 px con datos ficticios, sin desbordamiento horizontal. El «Festivo de prueba» de la captura es una fixture, no una afirmación sobre el 31 de octubre.

No se han medido FPS, CPU, memoria ni impresión/instalación física en SUNMI. La migración, los contratos HTTP, el aislamiento por tienda y el worker sí se han validado en producción como se detalla arriba.

Documentación del proveedor meteorológico: https://open-meteo.com/en/docs

## Disponibilidad web y aviso

Storefront `6eaff22`, Railway `a2c44c6f-d655-4cc4-a02b-22b9977ffb80` SUCCESS. Verificación pública HTTP 200 y bundle `/static/js/main.016236e7.js` con caché de información diaria y previsión de cuatro fechas (hoy y los tres días siguientes). Nota activada en cinco idiomas con fecha `2026-10-28T10:16:12.405Z`; su texto indica que requiere la nueva versión del POS.
