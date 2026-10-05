# Punto 3: equipo y notificaciones en fase 2

4 de octubre de 2026. Implementado en local; no publicado. Se conservan los cambios locales de los puntos 1 y 2.

## Recorrido

El formulario se divide en cuatro pasos: datos del negocio; cuenta y documentos; equipo y SMS; resumen. Se puede navegar hacia atrás y guardar el avance para volver desde el mismo enlace. El envío final valida todos los pasos y lleva al primer campo pendiente.

El bloque del POS exige una elección explícita:

- Compra al contado: 250 € IVA incluido.
- Compra en 2–6 cuotas sin intereses: 250 € en total. Calendario propuesto mensual, primera cuota en el cierre antes de la firma; sin fecha de cobro inventada. Seis cuotas: cinco de 41,67 € y una de 41,65 €.
- Solicitud de oferta de alquiler: sin renta ni fianza inventadas. El equipo permanece en propiedad de Volta; devolución y responsabilidades por daños/extravío deben concretarse en la oferta y contrato siguientes. Solicitar la oferta no equivale a aceptar esas condiciones.

Los SMS quedan identificados como recarga inicial pendiente de precio y número de mensajes. No se permite elegir un paquete ficticio ni se trasladan automáticamente las tarifas actuales de recargas de otro flujo. El resumen muestra el primer importe conocido del POS y marca el total inicial como pendiente de oferta, nunca como cero.

Se informa de pagos del POS/SMS separados de las ventas, reparto 90/9/1 y liquidaciones sobre fondos cobrados disponibles, sin anticipos. No se promete un plazo de liquidación: debe acordarse antes del cierre. Esta pantalla recoge preferencias para revisión, no cobra ni firma.

## Persistencia y controles

Sin migración adicional: usa el JSON existente `OnboardingRequest.formalData`.

- El catálogo versionado se entrega con el expediente. El servidor calcula importes en céntimos, calendario y snapshot `commercialSelection`; ignora precios, pagos o propiedad enviados por el navegador.
- `POST /api/onboarding/form/:token/draft` guarda únicamente campos admitidos en `onboardingDraft`, sin cambiar fase, enviar correo ni subir archivos. Los documentos ya subidos se conservan. Los archivos seleccionados localmente se suben al envío final; la interfaz avisa de que hay que seleccionarlos de nuevo si se cierra antes.
- El envío final valida versión, elección y confirmación; guarda el snapshot antes de la notificación existente de revisión y bloquea cambios mientras está en revisión. Una devolución a `NEEDS_INFO` permite corregirlo.
- Las escrituras comparan estado y `updatedAt` para evitar que una petición en curso pise una transición concurrente. La respuesta informa de conflicto si cambia el expediente durante la escritura.
- La administración ve el resumen guardado y distingue borrador de envío a revisión.

## Dependencia explícita del punto 4

Las nuevas solicitudes con condiciones económicas **no pueden enviarse ni firmarse con el contrato antiguo**. El bloqueo existe tanto en UI como en servidor, incluso si se cambia manualmente su estado a `CONTRACT_SENT`. Los expedientes históricos sin esta elección mantienen su recorrido anterior.

Antes de publicar el recorrido completo faltan: precio/condiciones del alquiler, tarifa y paquete SMS, calendario de liquidaciones, oferta aprobada e inmutable, aceptación de cambios, pago separado y confirmación del servidor, firma vinculada y tratamiento de pago sin firma. El punto 4 debe sustituir expresamente el guard `needsCommercialClosure` por las comprobaciones del cierre completo; no basta con quitarlo.

No se han generado pagos, enviado correos reales, firmado contratos ni cambiado clientes de producción. La nota de novedades permanece como borrador fuera del feed.

## Verificación

19 pruebas de backend aprobadas en los conjuntos de economía del onboarding, autenticación, autorización web y avisos. 6 pruebas de frontend aprobadas: cuotas, alquiler pendiente, selección explícita, reanudación de borrador, envío, bloqueo y errores de validación. Compilación de producción verificada. La persistencia HTTP se probó con una base simulada; no contra producción.
