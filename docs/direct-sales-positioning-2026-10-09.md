# Venta directa y solicitud de demostración

Implementación local del 9 de octubre de 2026, basada en la auditoría comercial aprobada. Pendiente de despliegue conjunto de backend y storefront.

## Presentación

Se conservan las secciones principales, paleta, animación del motor y vistas de producto. La portada incorpora el eslogan oficial «El motor para vender pizzas por Internet», explica venta directa y repetición, y conecta QR, cupones, Top Deals, liquidaciones y segmentación con una secuencia comercial. Las cifras de las vistas son ejemplos ilustrativos, no resultados de clientes. No se promete migración ni aumento garantizado de ventas, ni una API pública o integración universal.

Se muestran 90 % para el comercio y 10 % de comisión de servicio. El bloque de condiciones explica el reparto existente 90/9/1, los pagos separados de POS y SMS y la concreción de condiciones antes de contratar. No cambian cálculos de comisión, ofertas guardadas, contratos firmados ni liquidaciones. La presentación de incorporación y la firma HTML de los correos se alinean; no se reescriben contratos históricos.

El footer sustituye las marcas sin relación acreditada por enlaces de venta directa y la imagen con la identidad antigua por el nombre Volta Pizza. Inglés y redes sociales se identifican como próximamente; no se inventan perfiles. Los metadatos de la portada se actualizan tanto en React como en el servidor HTML; las tiendas conservan sus metadatos específicos.

## Demo separada del alta

`POST /api/onboarding/demo-requests` guarda una consulta en `OnboardingRequest` con `formalData.requestKind = DEMO`, sin catálogo de precios ni cierre comercial. No requiere migración. Envía únicamente un acuse de demostración y devuelve `{ok:true}`, sin token ni enlace al formulario. Si falla el correo, la consulta queda disponible en Global Manager y se confirma su recepción en la web.

Global Manager distingue las demos, muestra los datos de contacto y permite guardar notas y estado de seguimiento. El formulario, contrato, checkout y activación no están disponibles para una demo, aunque se conozca su token. Los estados avanzados también están bloqueados.

`POST /api/onboarding/requests/:id/invite-onboarding` exige sesión `global_admin` y confirmación expresa de que el negocio quiere continuar. Reserva el envío bajo bloqueo de fila, toma el catálogo vigente y envía la invitación habitual. Solo tras un envío correcto cambia a `ONBOARDING` y `EMAIL_SENT`; los fallos conservan la demo y admiten reintento. Una invitación ya enviada no se duplica al repetir la petición. Durante el envío se bloquean el cierre y la eliminación de la consulta. La reserva caduca a los dos minutos para permitir recuperación tras interrupciones; un resultado externo ambiguo de SMTP podría requerir comprobación humana antes de reintentar.

La ruta anterior de solicitudes se conserva para los recorridos de alta existentes. No se envían invitaciones automáticamente a las consultas anteriores ni se convierten retrospectivamente en demos.

## Validación

- 53 pruebas de backend: demo, límites de acceso, token codificado e ID alternativo, seguimiento, invitación concurrente e idempotente, fallos/reintento de correo, incorporación, contratos y avisos.
- 13 pruebas de frontend: portada, petición de demo y recuperación tras error, seguimiento administrativo, invitación expresa, expediente firmado anterior, presentación comercial y SEO.
- `npm run build` correcto, incluido el validador de ingredientes. Permanecen avisos previos de Browserslist y tamaño del paquete.
- Revisión visual local a 1280 px y de la portada/formulario a 393 y 320 px: sin desbordamiento horizontal. Captura en `../../output/commercial-positioning/landing-desktop.jpg`.
- Correos, base de datos y pagos simulados en las pruebas; no se enviaron mensajes ni se crearon expedientes reales. No se ha medido mejora de conversión ni se han instalado herramientas de analítica.

## Publicación

Desplegar primero el backend compatible y después el storefront para evitar que el nuevo formulario apunte a una ruta inexistente. Comprobar la recepción de una demo autorizada y su visibilidad en Global Manager antes de activar `directSalesPositioningAnnouncementDraft`. La nota incluye ES/EN/IT/FR/PT y permanece fuera del feed hasta esa verificación. El workspace contiene además cambios anteriores de códigos de pedido y selección de tienda: revisar el conjunto antes de preparar la entrega de producción.
