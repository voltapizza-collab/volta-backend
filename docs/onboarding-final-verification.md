# Punto 5: verificación local y prueba final de Luigi

5 de octubre de 2026. Implementación y comprobaciones locales completadas. **No está publicado.** Luigi realizará las pruebas externas de correo, Stripe y puesta en marcha. No se han enviado correos reales, cobrado pagos ni modificado comercios de producción durante esta comprobación.

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
3. Para ensayar cobros sin dinero real, configurar Stripe en modo prueba y el webhook `POST /api/onboarding/stripe/webhook`, con su secreto y eventos del documento de cierre. **La configuración local inspeccionada contiene una clave Stripe LIVE, carece de `STRIPE_ONBOARDING_WEBHOOK_SECRET` y no tiene `VOLTA_ADMIN_USERNAME`/`VOLTA_ADMIN_PASSWORD_HASH`.** No se modificaron esas variables. La configuración del servidor de despliegue debe comprobarse por separado.
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
