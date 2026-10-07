# Presentación del alta y pago con tarjeta — 7 de octubre de 2026

El correo de fase 2 distingue contado (amarillo), plazos (lavanda) y renting (verde claro), con un botón principal morado «Continuar a la fase 2». Los métodos conservan enlaces de preselección; el botón principal abre el formulario sin imponer una modalidad. No se añaden precios al correo.

Los nuevos documentos incluyen una referencia `VLT-AÑO-EXPEDIENTE-EMISIÓN`, por ejemplo `VLT-2026-000123-01`, estable durante la revisión, diferente por solicitud y emisión y cubierta por el hash del contrato. El correo, la pantalla y el nombre de descarga usan esa referencia. Los documentos y firmas anteriores no se reescriben; se muestra una referencia junto a su contenido original.

El checkout del onboarding omitía los métodos explícitos y heredaba Link de la cuenta de Stripe. Ahora envía `payment_method_types[0]=card` y `wallet_options[link][display]=never`, igual que el flujo existente de pedidos. Al volver a pulsar Pagar, un checkout anterior abierto y sin pagar se caduca antes de crear el de tarjeta. Si el pago se completa durante esa operación, se conserva; los pagos asíncronos en proceso tampoco se sustituyen. Una creación antigua con resultado desconocido se recupera primero con sus parámetros e idempotencia originales.

Validación: 58 pruebas de backend (onboarding, Stripe y avisos), 13 pruebas de interfaz y compilación de producción correctas. Incluye idempotencia, reintentos concurrentes, carrera entre caducidad y pago, pagos en proceso, integridad de contratos antiguos y nuevos. Correo revisado visualmente a 390 y 680 px sin desbordamientos. Capturas con datos ficticios en `../../output/onboarding-design-card-2026-10-07/`. No se envían correos externos ni se cobran pagos de prueba.

La nota `onboardingPresentationAnnouncementDraft`, en ES/EN/IT/FR/PT, se activará tras verificar ambos despliegues. Los correos ya recibidos no cambian; los nuevos envíos usarán el diseño actualizado.
