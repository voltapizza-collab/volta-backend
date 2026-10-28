# Optimización POS — implementación local, 28/10/2026

La entrega está preparada localmente. No se ha desplegado, publicado, asignado ni instalado la APK, y la migración no se ha ejecutado.

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

## Activación pendiente

1. Revisar y desplegar únicamente los cambios de esta entrega junto con los cambios ajenos que sus responsables decidan incluir; ambos repositorios contienen trabajo previo sin commit.
2. Aplicar la migración mediante el procedimiento habitual, generar el cliente Prisma y verificar la preparación de columnas multimedia que ya realiza el arranque. No ejecutar DDL desde lecturas del POS.
3. Desplegar backend con `POS_OUTBOX_ENABLED` desactivado, comprobar el nuevo contrato de historial y la recepción de reportes; activar la cola después de comprobar su tabla y worker. Con el indicador desactivado continúa el envío síncrono anterior.
4. Publicar la APK firmada por el flujo existente y asignarla por lotes, comenzando por un grupo controlado. La versión candidata local es 0.3.26, código 29; comprobar que no haya sido ocupada por otra publicación antes de publicarla. No requiere eliminar la aplicación ni perder su sesión.
5. Observar `fleet` y el detalle de reportes: versión instalada, estado saludable, plazos de espera, errores y reportes recientes. La nueva lógica requiere llegar primero a los clientes antiguos. La falta del permiso Android o una confirmación obligatoria del sistema no se puede resolver simulando un permiso desde JavaScript.
6. Publicar `posPerformanceAnnouncementDraft` en ES/EN/IT/FR/PT solo cuando la mejora esté disponible. Actualmente queda fuera del feed.

Para retirar una distribución, usar el procedimiento existente `withdraw`/`unassign`; no autorizar un downgrade. Para desactivar nuevos trabajos de la cola, retirar el indicador y conservar los registros existentes para reconciliación; no borrar ni reenviar trabajos `PROCESSING` o `REVIEW` sin contrastar sus resultados.

## Evidencia local

En 60 segundos simulados, misma tienda y cola vacía: renderizados de `PosApp` 68 → 12; consultas de clima 4 → 0 y calendario 4 → 0 después de la carga inicial. Las consultas operativas mantienen su frecuencia. El reloj continúa actualizándose cada segundo en su componente aislado. Un pedido aparece con la consulta de presencia retenida.

Pruebas Jest de interfaz, Node de backend con dobles de base de datos/proveedor, pruebas Java de consentimiento/cadencia/exclusión y compilación/firma Android. Prueba visual del bundle de producción en Edge a 360 px con datos ficticios, sin desbordamiento horizontal. El «Festivo de prueba» de la captura es una fixture, no una afirmación sobre el 31 de octubre.

No se han medido FPS, CPU, memoria ni impresión/instalación física en SUNMI. La migración y el worker no se han validado contra una base de datos de producción; esa comprobación pertenece a la activación controlada.

Documentación del proveedor meteorológico: https://open-meteo.com/en/docs
