# Renting con plazo elegido por el comercio

6 de octubre de 2026. Luigi aprobó dividir el precio del POS entre el plazo y aclaró que **36 meses es el máximo**, no una duración obligatoria. La configuración `CUSTOMER_TERM` permite elegir de 1 a 36 mensualidades; no se ha solicitado un mínimo superior. Las modalidades históricas de cuota fija y divisores 24/36 se conservan para compatibilidad.

La solicitud nueva guarda un catálogo con los plazos y sus importes. El comercio debe elegir un plazo expresamente; puede guardarlo como borrador y reanudarlo. El servidor calcula y guarda cuota, duración y total desde ese catálogo, ignorando precios enviados por el navegador y rechazando plazos fuera de las opciones. Un cambio posterior de tarifa no reescribe la selección, oferta ni contrato.

Cada cuota es el precio del POS dividido entre los meses elegidos, redondeado a céntimos. El total es cuota × meses, visible antes de enviar y firmar. Con 250 €: 12 × 20,83 € = 249,96 €; 24 × 10,42 € = 250,08 €; 36 × 6,94 € = 249,84 €. No se añade una cuota final para ajustar el redondeo.

El contrato, el correo de cierre, el resumen y el primer pago utilizan el plazo guardado. El periodo empieza en la entrega operativa. El POS pertenece a Volta hasta terminar ese plazo y completar sus pagos; entonces se transmite sin pago residual ni mensualidad adicional. Las cuotas posteriores siguen gestionándose por separado: esta entrega no añade cobros recurrentes automáticos.

El orden sigue siendo revisión de Volta → correo → firma → pago inicial confirmado → alta y bienvenida. Las solicitudes anteriores conservan su catálogo y las ofertas emitidas conservan el contrato exacto.

## Publicación y verificación

Desplegar backend y storefront antes de seleccionar `CUSTOMER_TERM` en la tarifa general; la versión anterior del backend no reconoce ese valor. No necesita migración SQL. Activar la novedad del renting solo después de comprobar ambos servicios y la configuración. Usar una solicitud nueva para revisar el selector.

Pruebas: los 36 plazos y entradas inválidas; importes enviados por el cliente; guardado/reanudación y envío HTTP; contrato y primer cobro de 12 meses; firma y alta única con webhook repetido; correos con duración elegida; conservación de catálogos anteriores. Los ensayos capturan correos y simulan Stripe, sin cobros ni correos externos.
