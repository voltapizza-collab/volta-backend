# Avisos del backoffice

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
