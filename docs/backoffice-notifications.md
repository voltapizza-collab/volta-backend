# Avisos del backoffice

## Opciones documentadas al buscar ingredientes — borrador local

`ingredientDiscoveryAnnouncementDraft` incluye ES/EN/IT/FR/PT y permanece fuera del feed. Describe las sugerencias acotadas de entrecot y aceitunas verdes del lote 33 en Global Manager. Activarlo con fechas reales solo cuando esté disponible el storefront correspondiente y se haya revisado el destinatario de la nota; no anuncia cambios en la búsqueda del inventario de los negocios. No cambia identificadores ni revisiones de avisos publicados.

## Disponibilidad al crear pedidos — borrador local

`checkoutAvailabilityAnnouncementDraft` incorpora ES/EN/IT/FR/PT y permanece fuera del feed. Activarlo con fechas reales únicamente después de publicar juntos la validación de checkout del backend y el refresco de carta del storefront. La interfaz mantiene el carrito y señala el artículo rechazado. La nota no anuncia cancelación retroactiva de pedidos ya creados. Evidencias en `ingredient-taxonomy-v2-audit-2026-09-18.md`.

## Familias de ingredientes para restaurantes — borrador local

`ingredientRestaurantTaxonomyAnnouncementDraft`, en `data/backofficeAnnouncements.js`, incluye ES/EN/IT/FR/PT y permanece fuera de `backofficeAnnouncements`. Al publicar la organización nueva del catálogo y el inventario, fijar fechas reales de publicación y caducidad y añadirla al feed después de comprobar backend y storefront. No requiere aumentar la revisión de otros avisos. Véase `ingredient-taxonomy-v2-implementation.md`.

## Lectura de avisos uno a uno — ajuste local pendiente de publicación

Los avisos se muestran sin las pestañas Pendientes e Historial. Abrir Avisos con lecturas pendientes presenta directamente la primera ficha; marcarla como leída avanza a la siguiente. Al terminar las novedades, el diálogo muestra «Estás al día» y el botón Historial. Este acceso también aparece al abrir Avisos cuando ya no quedan novedades por leer. El historial permite abrir una ficha y volver a su lista, sin repetir los avisos leídos. La lista y el contenido guardado se limitan a los 10 avisos leídos más recientes por fecha de publicación, de más nuevo a más antiguo. Los historiales anteriores se recortan automáticamente, conservando todos los comprobantes de lectura para que los avisos retirados no vuelvan a notificarse. El contador también queda limitado a 10.

Las alertas SMS siguen el saldo real. Posponerlas no las marca como leídas ni las archiva; si queda una alerta operativa después de leer las novedades, el cierre del recorrido indica que la recarga sigue pendiente, sin afirmar que todo está al día. Se conservan las claves de lectura y las traducciones. La nota existente se adapta sin cambiar su identificador ni revisión. Publicar este ajuste del storefront antes o junto con el catálogo del backend.

## Pendientes e historial — 17 de septiembre de 2026

La apertura manual de Avisos ahora muestra una bandeja de **Pendientes** y un **Historial**. Antes, abrir Avisos volvía a encolar todas las novedades, incluidas las que ya estaban marcadas como leídas; esto podía mostrar el cartel con «Leído» y «Continuar», como en la captura reportada.

Marcar como leído, desde una ficha o desde la lista, mueve la novedad al historial. Los carteles automáticos y su cola excluyen las lecturas nuevas, incluidas las recibidas de otra pestaña. Las lecturas anteriores mantienen sus claves `id:revision` y migran al historial cuando su contenido está disponible. Un cambio real de revisión puede volver a notificar; no se han cambiado las revisiones publicadas para esta corrección.

El historial guarda el contenido y todas sus traducciones por negocio en este navegador, por lo que una novedad leída sigue consultable cuando caduca o sale del feed. Sus entradas también cuentan como comprobantes de lectura. Los comprobantes ya no se recortan a los últimos 500. Se conservan las lecturas simultáneas de otras pestañas; si el almacenamiento falla, hay respaldo en memoria durante la sesión de la página. No hay sincronización entre dispositivos u orígenes y borrar los datos del navegador elimina este historial; una novedad ya retirada antes de esta actualización no puede reconstruirse solo a partir de su identificador antiguo.

Las alertas operativas SMS conservan su comportamiento: se resuelven con el saldo, no al marcarlas como leídas. Su destino continúa conectado al formulario de recarga existente.

Validación: 22 pruebas de interfaz, 7 de backend, compilación de producción y recorrido con Edge en escritorio, 393 px y 320 px. Se verificaron archivo desde la lista, consulta de historial, recarga sin repetición, traducciones y teclado. Capturas en `../output/notification-inbox/`. La corrección se publicó en producción el 17 de septiembre de 2026 (storefront 2314d2f). No requiere migración. `notificationInboxAnnouncement` está activa en ES/EN/IT/FR/PT tras comprobar la publicación del backend y el storefront.

Implementación del 12 de septiembre de 2026. Requiere publicar tanto el backend como el storefront. No necesita migraciones ni cambios en el proceso de cobro.

## Saldo de SMS

`GET /api/backoffice-notifications/:partnerId` lee `Partner.smsCredits` y `smsLowBalanceThreshold`. Responde sin caché con avisos ordenados por urgencia. Es una lectura del mismo saldo que utiliza la compra de SMS; no consulta ni modifica el saldo del proveedor.

- Saldo bajo: umbral del negocio, actualmente 50 por defecto.
- Urgente: de 1 a 10 créditos, incluso si el umbral configurado es menor.
- Agotado: 0 créditos. Los mensajes largos pueden consumir varios créditos.
- La alerta desaparece cuando el saldo supera el umbral. No se puede marcar como resuelta desde el cartel.

El storefront comprueba el saldo al montar el backoffice, cada 60 segundos mientras la pestaña está visible, al recuperar el foco o la conexión y al recibir `volta:sms-balance-changed`. Cancela peticiones al salir. Un error se muestra en Avisos y conserva el último resultado con una indicación de que puede estar desactualizado.

Si falla la ruta de avisos, el storefront consulta el saldo en la ruta existente `/api/sms-credits/:partnerId`. Una respuesta válida permite seguir mostrando las alertas de saldo y señala que las novedades están temporalmente pendientes. Un saldo desconocido nunca se convierte en cero. No hay lectura alternativa ante errores de autenticación, autorización o `partner_not_found`. La comprobación siguiente vuelve a intentar la ruta de avisos. Así se tolera que frontend y backend se actualicen en momentos distintos.

Los avisos operativos vuelven en cada apertura del backoffice o inicio de sesión mientras siga el problema. Dentro de una misma apertura no interrumpen por cada SMS consumido: reaparecen al cambiar de nivel o si el problema se resuelve y vuelve a producirse.

`Recargar ahora` abre `/Backoffice?section=sms-credits`, selecciona Clientes → Comunicación y enfoca el formulario `SmsCreditsPanel` existente. La compra sigue usando `/api/sms-credits/:partnerId/checkout-session` y el mismo retorno `sms_payment` de Stripe.

## Publicar una mejora o un aviso

Añadir la nota a `data/backofficeAnnouncements.js` en el mismo cambio que entrega la mejora. El registro se publica con el backend y llega a las sesiones abiertas en su siguiente comprobación. Los mensajes describen la función y su utilidad para el administrador; no se extraen automáticamente mensajes técnicos de Git. Un commit sin una entrada no genera una novedad.

```js
{
  id: "mejora-entregas-2026-09",  // único, estable
  revision: 1,                    // incrementar para pedir otra lectura
  publishedAt: "2026-09-15T08:00:00.000Z",
  expiresAt: "2026-12-15T08:00:00.000Z", // opcional
  category: "improvement",       // improvement | maintenance | notice
  severity: "info",              // info | warning | urgent | critical
  title: "Una mejora para tus entregas",
  message: "Explica qué cambió y cómo usarlo.",
  detail: "Contexto adicional opcional.",
  // partnerIds: [7],            // opcional; sin este campo llega a todos
  action: { label: "Ver configuración", target: "settings" }, // opcional
}
```

Destinos admitidos: `sms-credits`, `communications`, `settings`, `settings-tracking`. Los destinos son internos y predefinidos. No se renderiza HTML de los avisos. Se omiten notas futuras, caducadas, inválidas o destinadas a otros negocios. Retirar una nota del catálogo la retira también del centro de avisos.

El idioma sigue el selector del backoffice (ES, EN, IT, FR, PT). El título del centro en inglés es **Notifications** y los avisos urgentes son **Alerts**. Los textos generales y las alertas de saldo usan `createBackofficeTranslator`; las fechas y cantidades usan el mismo idioma. Cambiarlo no crea otra notificación ni reinicia la lectura.

En cada novedad, los campos raíz contienen el texto español. Incluir `translations.en`, `translations.it`, `translations.fr` y `translations.pt`, cada uno con `title`, `message` y, si corresponde, `detail` y `actionLabel`. El catálogo de producción se valida en pruebas para que todas las notas incluyan los cuatro idiomas. El cliente mantiene compatibilidad con notas antiguas sin traducciones; si falta el idioma solicitado, usa inglés cuando existe y después el texto original.

Las novedades dejan de abrirse al marcarlas como leídas y permanecen en Avisos mientras sigan publicadas. Cerrar con × o Escape no las marca como leídas. Las lecturas se guardan en este navegador por negocio y revisión; no se sincronizan entre dispositivos. Si el almacenamiento está bloqueado, funcionan durante la apertura actual. No hay editor de publicaciones en Global Manager: las notas se mantienen en el registro de código.

## Validación

`node --test tests/backofficeNotifications.test.js` comprueba umbrales, fechas, audiencias, enlaces, aislamiento por negocio y errores de lectura. Está incluido también en `npm test`; cada publicación valida todo el catálogo.

En el storefront: `node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand --runTestsByPath src/components/Backoffice/Notifications/BackofficeNotifications.test.jsx`, seguido de `npm run build`.

Validación local completada: 30 pruebas de backend (avisos, créditos/Telnyx y notificaciones de seguimiento), 9 del centro de avisos, compilación de producción y recorrido de navegador con saldo y cobro simulados. Se comprobaron escritorio de 1440 px, móvil de 393 y 320 px, prioridad de alertas, teclado, lectura persistida, enlace directo y llamada al checkout existente. Las pruebas no enviaron SMS ni realizaron pagos.

### Traducciones y corrección de conexión, 12 de septiembre

La captura del usuario mostraba el resultado de una ruta inexistente. Se verificó HTTP 404 en `/api/backoffice-notifications/1` y HTTP 200 con 0 créditos en `/api/sms-credits/1`. El proceso local de Node todavía no había cargado la nueva ruta. Tras reiniciarlo, la ruta de avisos responde HTTP 200, saldo agotado y las novedades con EN/IT/FR/PT. El storefront local sirve la nueva compilación `main.854f884d.js`.

Pasaron las 6 pruebas del backend y las 15 del centro de avisos, incluida la lectura alternativa, sus errores, todos los idiomas y conservación de recibos. Compilación correcta. En una vista local aislada que permite únicamente lecturas se comprobó el saldo real de MyCrushPizza: 0 SMS. El navegador mostró la alerta en inglés, la cambió a español con el selector y mantuvo la alerta en inglés simulando HTTP 404 en la ruta de novedades. No se enviaron SMS ni se abrieron pagos. Esta comprobación no despliega los cambios en producción.
## Reparto y revisión manual — borrador local del 18 de septiembre

`checkoutDeliveryAnnouncementDraft` contiene ES/EN/IT/FR/PT y permanece fuera del feed. Publicar con backend, storefront y POS actualizados, tras la comprobación del Sunmi. Explica la revisión de tarifa antes de confirmar y la señal de reparto pendiente de comprobación humana. No anuncia que toda dirección aceptada tenga cobertura verificada. Véase `checkout-delivery-repair-2026-09-18.md`.
