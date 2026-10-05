# Revisión, firma, pago y alta

La revisión deja de exigir una oferta manual por comercio. El administrador revisa los datos, los documentos y el contrato generado, confirma que puede suministrar el POS y pulsa **Enviar correo de pago**. Los importes proceden de la elección guardada; el formulario no puede sustituirlos. Si no existe una cuota de renting, se muestra la tarifa que falta configurar, sin inventar un importe.

El correo permite firmar primero y pagar después desde el mismo enlace. La firma conserva el texto, su huella y la evidencia de aceptación, pero no crea negocio, tienda ni accesos. La solicitud permanece pendiente de pago.

El webhook de Stripe verifica sesión, importe, moneda, intención y cobro efectivo. Solo entonces se crea el alta y se envía la bienvenida con la invitación para crear contraseña, enlaces, QR e instrucciones. La recepción de pedidos sigue cerrada hasta preparar la tienda. La conciliación y la actualización de estado también recuperan una activación interrumpida. El efectivo confirmado usa el mismo cierre, tras la firma.

Los bloqueos de base de datos evitan duplicar negocios y recargas. Un fallo de correo conserva el alta y devuelve error recuperable para que Stripe reintente; el correo enviado queda registrado y no se repite con eventos posteriores. El reenvío explícito desde Global Manager sigue disponible. Un cobro pendiente, incorrecto, devuelto, disputado o cancelado no autoriza una nueva activación.

Las versiones anteriores ya emitidas mantienen su documento y recorrido. Los nuevos contratos llevan `SIGN_PAY_ACTIVATE` dentro de la huella del documento. No se cambian precios, pagos ni firmas históricas. No requiere migración de base de datos.

Verificación: pruebas HTTP con correo capturado y Stripe simulado para contado, plazos y renting; firma previa sin alta; evento sin cobro; alta única; reintento tras fallo de correo; cotización modificada; revisión con precio congelado; autorización; compatibilidad anterior. Pruebas React y compilación de producción. Las pruebas externas de cobro y recepción de correo quedan a cargo de Luigi.
