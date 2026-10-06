# Revisión, firma, pago y alta

## Estado al 6 de octubre de 2026

Recorrido publicado: backend `20c7563` y storefront `e797728`, ambos SUCCESS en Railway. Se verificaron en producción el acceso administrativo, las tarifas, el presupuesto SMS, las protecciones de las rutas y del webhook y el bundle `main.673508e9.js`. La sonda firmada del webhook no representa un pago ni una entrega originada por Stripe.

POS: 250 €; SMS: 0,075 € por parte, con 133 partes por 10 €. Tras esta comprobación, Luigi aprobó dividir el precio del POS entre el plazo y aclaró que 36 meses es el máximo elegido por cada cliente. La configuración fija `PRICE_36` se guardó inicialmente (revisión 3); la entrega de [renting con plazo elegido](onboarding-rental-terms.md) ya la sustituyó por `CUSTOMER_TERM` (revisión 4), tras verificar ambos despliegues. POS y SMS conservan sus precios.

El verificador anterior seleccionaba un expediente histórico sin elección comercial y recibía `submitted_selection_required` (409). Se corrigió la selección del verificador. No se encontró una solicitud pendiente apta para comprobar la vista previa nueva en producción; no se creó ni modificó una para esta comprobación.

Las pruebas locales del cambio anterior constan con 22 pruebas específicas y 14 de interfaz aprobadas, compilación correcta y suite general de 328 aprobadas y 1 omitida. Las verificaciones de producción no sustituyen la recepción de correos, un cobro real, la subida de documentos ni el primer pedido con impresión. El punto 5 sigue abierto hasta completar esas pruebas.

Esta guía sustituye el orden de pago antes de firma de los documentos históricos para los nuevos contratos. Los documentos ya emitidos conservan su recorrido.

## Funcionamiento

La revisión deja de exigir una oferta manual por comercio. El administrador revisa los datos, los documentos y el contrato generado, confirma que puede suministrar el POS y pulsa **Enviar correo de pago**. Los importes proceden de la elección guardada; el formulario no puede sustituirlos. Si no existe una cuota de renting, se muestra la tarifa que falta configurar, sin inventar un importe.

El correo permite firmar primero y pagar después desde el mismo enlace. La firma conserva el texto, su huella y la evidencia de aceptación, pero no crea negocio, tienda ni accesos. La solicitud permanece pendiente de pago.

El webhook de Stripe verifica sesión, importe, moneda, intención y cobro efectivo. Solo entonces se crea el alta y se envía la bienvenida con la invitación para crear contraseña, enlaces, QR e instrucciones. La recepción de pedidos sigue cerrada hasta preparar la tienda. La conciliación y la actualización de estado también recuperan una activación interrumpida. El efectivo confirmado usa el mismo cierre, tras la firma.

Los bloqueos de base de datos evitan duplicar negocios y recargas. Un fallo de correo conserva el alta y devuelve error recuperable para que Stripe reintente; el correo enviado queda registrado y no se repite con eventos posteriores. El reenvío explícito desde Global Manager sigue disponible. Un cobro pendiente, incorrecto, devuelto, disputado o cancelado no autoriza una nueva activación.

Las versiones anteriores ya emitidas mantienen su documento y recorrido. Los nuevos contratos llevan `SIGN_PAY_ACTIVATE` dentro de la huella del documento. No se cambian precios, pagos ni firmas históricas. No requiere migración de base de datos.

Verificación: pruebas HTTP con correo capturado y Stripe simulado para contado, plazos y renting; firma previa sin alta; evento sin cobro; alta única; reintento tras fallo de correo; cotización modificada; revisión con precio congelado; autorización; compatibilidad anterior. Pruebas React y compilación de producción. Las pruebas externas de cobro y recepción de correo quedan a cargo de Luigi.
