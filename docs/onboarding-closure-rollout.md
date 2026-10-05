# Punto 4: oferta, pago inicial y firma

5 de octubre de 2026. Implementación local, pendiente de publicación. Se continúa la base de cierre existente y se conservan los cambios locales de los pasos 1–3. No se han cobrado pagos, enviado correos reales ni activado comercios de producción.

## Recorrido implementado

Global Manager → Onboarding → expediente → Oferta y cierre permite preparar el documento completo con precio del POS, condiciones del equipo, calendario de liquidaciones, SMS, plazos de firma/devolución y disponibilidad/fechas de entrega. Preparar la oferta no envía correo ni inicia cobros; el envío del correo de cierre es una acción separada.

Contado y compra en 2–6 cuotas admiten un precio por expediente (IVA incluido, de 1 a 10.000 €). El servidor calcula el calendario y redondeo, el contrato y el primer pago a partir de ese importe. Si cambia el precio elegido en fase 2, el cliente ve el importe anterior y el nuevo antes de aceptar. El renting exige cuota, posible fianza explícita y condiciones aprobadas de cancelación anticipada: 36 mensualidades, inicio en entrega operativa, propiedad de Volta durante el plazo y transmisión final tras completar plazo y pagos, sin residual. No se ha fijado 11 € como tarifa.

El bloque «Tarifa del POS para nuevas altas» modifica el valor propuesto para nuevas solicitudes. Se conserva un catálogo en cada nueva solicitud; cambiar la tarifa general no modifica expedientes ya creados, ofertas, pagos o contratos. Los expedientes anteriores sin catálogo conservan una referencia inicial de 250 €, modificable expresamente en su oferta. Los cambios simultáneos de tarifa u oferta se rechazan cuando la versión quedó desactualizada.

Se requiere stock confirmado o reposición con fecha comprometida, referencia de suministro, fecha prevista, fecha límite y condiciones de retraso/devolución. Sin esos datos no se prepara la oferta. Las tres modalidades informan de stock; contado pagado tiene prioridad entre asignaciones pendientes, respetando compromisos previos. Esta es una confirmación administrativa, no un inventario físico ni un asignador automático de unidades. Una fecha límite vencida impide crear un nuevo cobro hasta revisar la oferta.

El cliente ve y puede descargar el documento completo antes de aceptar las condiciones del pago previo. Stripe recibe conceptos separados para POS, fianza si existe y SMS, en un solo pago inicial ajeno a las ventas. El servidor confirma importe, moneda, identidad de operación y estado del pago. Regresar del checkout no habilita la firma. Contado en efectivo exige recibo y confirmación del administrador.

Solo con pago confirmado, consentimiento de la misma versión y plazo vigente puede firmarse. La comprobación se repite bajo bloqueo al activar: contrato exacto, negocio/tienda y créditos SMS se guardan sin duplicarlos ante reintentos. La tienda queda cerrada a pedidos hasta su preparación. El documento firmado conserva la versión y el justificante; la descarga actual es texto UTF-8, no PDF.

El expediente permite reanudar, consultar estado y solicitar cancelación antes de la firma. Las devoluciones se tramitan desde Global Manager y registran referencia y estado; no son una tarea automática de fondo. Un pago incierto, revertido o una devolución fallida requiere conciliación. Los reintentos de Stripe usan identificadores estables; una operación incierta de más de 23 horas no se recrea automáticamente. No se eliminan expedientes con historial de cierre. Los contratos antiguos sin selección económica conservan su recorrido anterior.

## Preparación del despliegue

1. Desplegar conjuntamente las dependencias locales de acceso, fase 2 y cierre. Generar Prisma Client y aplicar `20261005120000_add_onboarding_pricing`; la migración de sesiones del paso 1 sigue siendo necesaria. La nueva tabla contiene solo la tarifa predeterminada; la primera lectura sin fila propone 250 € y la primera modificación crea la fila única. No ejecutar migraciones sobre producción como parte de una prueba local.
2. Configurar `STRIPE_SECRET_KEY`, `STRIPE_ONBOARDING_WEBHOOK_SECRET` y `PUBLIC_FRONTEND_URL` (o `FRONTEND_URL`). Webhook separado: `POST /api/onboarding/stripe/webhook`. Suscribir `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `refund.updated` y `refund.failed`. Confirmar modo test/live y firma del payload original. Sin configuración, checkout falla de forma explícita.
3. Probar Stripe en modo test y persistencia con la base de staging antes de habilitar cobros reales. Confirmar entrega del correo, regreso al expediente, firma duplicada, recuperación, pago tardío y devolución. El punto 5 añade un ensayo con MySQL real local aislado y Stripe/SMTP simulados: acredita la persistencia y concurrencia locales, pero no la configuración de servicios externos. Luigi realizará la comprobación externa.
4. Revisar y cargar condiciones aprobadas: contrato general, renta, cancelación anticipada, cobertura del equipo, tratamiento fiscal de la transmisión final, SMS, liquidaciones y plazos de suministro. La aplicación exige estos datos y no decide las tarifas comerciales pendientes.
5. Publicar las notas `onboardingClosureAnnouncementDraft` y `onboardingEmailsAnnouncementDraft` solo cuando esté disponible el conjunto. La revisión local del punto 5 está completada; las comprobaciones pendientes del entorno publicado están en [verificación final](onboarding-final-verification.md).

El cierre cobra únicamente el importe inicial. No crea una suscripción ni automatiza las siguientes 35 mensualidades, la entrega física o el documento de transmisión al mes 36; quedan sujetos al calendario y operación posterior del contrato. No presentar esta entrega como una plataforma completa de gestión del renting.

Referencias técnicas comprobadas: [confirmación de Checkout](https://docs.stripe.com/checkout/fulfillment), [idempotencia y ventana de retención de Stripe](https://docs.stripe.com/api/idempotent_requests).

## Verificación local

Pruebas de dominio y HTTP: precios variables y redondeo, stock/datos inválidos, catálogo congelado, revisiones concurrentes, aceptación, checkout duplicado y diferido, firma sin pago, efectivo, cancelación, devolución, alteración de contrato, caducidad, webhook firmado duplicado y rechazo de firmas incorrectas. La ruta real de firma se prueba con persistencia simulada para comprobar una única activación y recarga ante doble envío, manteniendo el contrato exacto y la tienda cerrada.

Pruebas de interfaz: contrato visible antes del pago, cambio de precio, controles de firma, cancelación/caducidad, precio por expediente, renting y tarifa general. Prisma validado y cliente generado. Compilación de producción correcta en `../output/onboarding-step4-build`. Verificación de backend: `node --test tests/onboardingClosure.test.js tests/onboardingCommercial.test.js tests/webAccess.test.js tests/backofficeAuthentication.test.js tests/backofficeNotifications.test.js tests/stripeCheckout.test.js` (39 pruebas). Interfaz: `OnboardingClosure`, `OnboardingCommercial` y `OnboardingFormPage.commercial` (11 pruebas).
