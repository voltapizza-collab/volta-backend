# Punto 5: verificación local y prueba final de Luigi

**Actualización del 6 de octubre de 2026:** el recorrido aprobado para nuevas revisiones es **revisión → correo → firma → pago confirmado → alta y bienvenida automática**. Backend `20c7563` y storefront `e797728` están publicados. El recorrido y la lista de comprobaciones de abajo describen la versión anterior; para solicitudes nuevas seguir la sección actual siguiente y [firma antes del pago](onboarding-sign-before-payment.md). No aplicar las instrucciones históricas de pagar antes de firmar a una solicitud nueva.

## Comprobación pendiente del recorrido actual

1. Crear una solicitud nueva con un correo de prueba autorizado, comprobar el primer correo, completar datos y documentos y elegir contado, plazos o renting. Los SMS no tienen casilla ni recarga obligatoria. Con la nueva tarifa `CUSTOMER_TERM`, el cliente elige el plazo de renting hasta un máximo de 36 meses y ve su cuota y total; comprobar el guardado y reanudación de esa elección. Ver [publicación del renting](onboarding-rental-terms.md).
2. En Global Manager, revisar datos, documentos y contrato generado. Los importes proceden de lo elegido por el comercio. Confirmar la revisión y el suministro del POS; pulsar **Enviar correo de pago** y comprobar la recepción del segundo correo.
3. Abrir el enlace, leer y firmar el contrato. Debe quedar pendiente de pago, sin negocio activado ni accesos. Volver al mismo enlace debe permitir continuar sin repetir la firma.
4. Completar el pago inicial y comprobar que su confirmación crea el alta una sola vez y envía la bienvenida con contrato, invitación de contraseña, QR y enlaces del negocio. **Stripe de producción está en modo LIVE: esta operación cobra dinero real.** Usar un entorno Stripe de prueba si se quiere ensayar sin dinero real. No cambiar las claves de producción para una prueba.
5. Crear la contraseña, abrir el negocio correcto, completar carta, horarios, ubicación y servicio. La recepción seguirá cerrada hasta abrirla explícitamente. Realizar un pedido y comprobar su recepción e impresión en el POS físico.

La verificación del 6 de octubre comprobó servicios, autenticación, tarifas, bundle y una sonda de webhook sin pago. No envió correos ni creó solicitudes. La prueba de vista previa de un contrato en producción quedó sin ejecutar porque no había una solicitud pendiente con selección comercial adecuada. El envío externo, documentos, pago y POS continúan pendientes.

## Historial de la versión anterior

5 de octubre de 2026. **Publicado en producción y comprobado el acceso y la recepción del webhook.** Backend `1a25491`, storefront `cbc372b`; ambos despliegues confirmados SUCCESS en Railway. Las dos migraciones se aplicaron correctamente. Se conservaron usuario y contraseña de Global Manager, con validación en el servidor. La variable del webhook y la clave estable de acciones están configuradas. Luigi realizará las pruebas externas de correo, pago real y puesta en marcha. No se han enviado correos, cobrado pagos ni modificado comercios durante la verificación de publicación. Las instrucciones de preparación siguientes se conservan como referencia para otros entornos.

## Cambios terminados

El recorrido utiliza tres correos principales: solicitud recibida para completar datos; oferta revisada para aceptar, pagar y firmar; bienvenida con invitación de acceso después de la firma. Enviar el formulario formal ya no genera un cuarto correo. El segundo muestra conceptos e importe inicial, modalidad, disponibilidad y fechas; el renting indica 36 mensualidades y transmisión final tras completar plazo y pagos. La bienvenida deja claro que la recepción de pedidos sigue cerrada.

Global Manager muestra el estado real del cierre y del envío. Si falla la bienvenida, el pago y el contrato permanecen guardados: «Reenviar bienvenida y acceso» genera una nueva invitación sin repetir alta ni créditos SMS. No se permite borrar un expediente con cierre económico ni cambiar manualmente sus fases para eludir los controles.

La comprobación con MySQL detectó que su almacenamiento JSON puede ordenar las claves de los objetos de otra forma. Las nuevas ofertas utilizan una huella con orden estable de claves, conservando el orden de las listas y la comprobación de alteraciones. No se reescriben contratos anteriores. También se bloquea el contrato antiguo desde que una nueva solicitud tiene catálogo comercial, incluso antes de completar fase 2.

## Evidencia local

- 60 pruebas de backend y 69 de interfaz aprobadas; compilación de producción correcta en `../../output/onboarding-step5-build`.
- Tres recorridos completos contra MySQL local aislado: contado, cuotas y renting. Se verificaron contrato exacto, una sola activación y recarga ante firma simultánea, webhook duplicado, tres correos, recepción cerrada y acceso autenticado al negocio correcto.
- Invitación de un solo uso, rechazo del acceso a otro negocio, conflicto entre cambios simultáneos de tarifa y recuperación de bienvenida fallida comprobados. Un cuarto expediente comprobó pago tardío, cancelación y devolución repetida sin activación.
- Migraciones SQL de sesiones y tarifa de onboarding aplicadas correctamente en otra base local vacía.
- Correos capturados sin envío externo y revisión visual de oferta de renting y bienvenida en navegador.

Informe: [report.json](../../output/onboarding-step5/report.json). Ejemplos: [solicitud](../../output/onboarding-step5/email-1.html), [oferta de renting](../../output/onboarding-step5/email-8.html), [bienvenida](../../output/onboarding-step5/email-3.html). Los importes y documentos del ensayo son datos sintéticos, no tarifas aprobadas. Los registros están en `../../tmp/onboarding-step5-*.log`.

El ensayo se reproduce con `scripts/rehearseOnboarding.js` y una base nueva cuyo nombre empiece por `onboarding_rehearsal_`, en MySQL local puerto 33317, indicada mediante `ONBOARDING_REHEARSAL_DATABASE_URL`. El script exige una base vacía y no la borra. Stripe se simula; el webhook firmado y la persistencia son reales. Los documentos se precargan como marcadores sintéticos: esto no comprueba la subida a Cloudinary.

## Preparar el entorno antes de probar

1. Publicar backend y storefront coordinadamente, generar Prisma Client y aplicar las migraciones de sesiones y precio indicadas en [accesos](web-access-rollout.md) y [cierre](onboarding-closure-rollout.md). Mantener las novedades en borrador hasta comprobar la publicación.
2. Configurar el administrador global conforme al documento de accesos, la firma de acciones/sesiones, URL pública y SMTP del entorno. Ejecutar `node scripts/checkOnboardingReadiness.js` desde el backend para revisar presencia de configuración sin mostrar secretos.
3. Para ensayar cobros sin dinero real, configurar Stripe en modo prueba y el webhook `POST /api/onboarding/stripe/webhook`, con su secreto y eventos del documento de cierre. **Producción utiliza Stripe LIVE:** completar un pago allí cobra dinero real. Se comprobó en Stripe el destino activo con los nueve eventos y en el backend la aceptación de una sonda firmada sin operación de pago y el rechazo de otra sin firma. Esto no sustituye la prueba de entrega originada por un pago en Stripe. Las variables del administrador, webhook y firma se comprobaron/configuraron en Railway; la copia local de `.env` no se sincronizó con esos secretos.
4. Cargar condiciones comerciales aprobadas: renta mensual, posible fianza, cancelación, SMS, liquidaciones y entrega. Los 250 € son la referencia inicial editable del POS; 11 € fue solo un importe de ensayo, no una renta aprobada.

## Recorrido que realizará Luigi

1. Crear una solicitud con correo controlado. Comprobar recepción y aspecto del correo 1; abrir su enlace, completar datos, subir documentos y elegir modalidad POS/SMS. Guardar, volver y enviar. No debe cobrarse ni enviarse otro correo de fase intermedia.
2. En Global Manager → Onboarding, abrir el expediente. Introducir precio y condiciones; confirmar disponibilidad o reposición con fechas. Sin stock ni fecha comprometida, mantener la espera sin pedir pago. Preparar y enviar la oferta: debe llegar el correo 2 con los mismos importes y fechas del contrato.
3. Desde el enlace privado, leer y descargar el contrato, revisar el desglose y aceptar expresamente las condiciones. Antes de confirmar el pago no se puede firmar. Completar el checkout de prueba o, para efectivo, registrar recibo y confirmación administrativa. Cerrar y volver al enlace: debe conservar el pago sin pedir otro.
4. Firmar y comprobar el correo 3, el contrato y justificante. Crear la contraseña desde la invitación. El enlace debe abrir ese negocio; con sesión de otro comercio debe exigir la cuenta correcta. Comprobar también recuperación de acceso y enlace POS.
5. Completar carta, horarios, ubicación y condiciones de servicio. La tienda debe seguir cerrada hasta usar la apertura explícita. Abrir recepción, realizar un pedido de prueba y verificar recepción e impresión en el POS físico, además de pausa y horarios.
6. Repetir contado, compra fraccionada y renting de 36 meses. Cambiar el precio de nuevas altas y comprobar que un expediente anterior conserva el suyo. En renting, comprobar total de 36 cuotas, propiedad de Volta durante el plazo, inicio en entrega operativa y transmisión final sin cargo 37.
7. Ensayar pago cancelado, pago confirmado sin firma, cancelación/devolución antes de firmar y reintentos. Si falla la bienvenida, reenviarla desde Global Manager: no debe duplicar negocio, pago ni saldo SMS. Comprobar en Stripe y en el correo externo lo que el ensayo local no acredita.

## Límites pendientes

La entrega incluye el primer cobro y las condiciones contractuales. No automatiza las mensualidades posteriores, la asignación física de stock, la entrega del POS ni el documento de transmisión al mes 36. Siguen pendientes de verificación externa la entrega SMTP, Stripe, documentos reales, el primer pedido completo y la impresión. El punto 5 se cerrará en el entorno publicado cuando Luigi complete esas comprobaciones.
