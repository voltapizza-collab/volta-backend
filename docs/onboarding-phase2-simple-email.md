# Revisión de fase 2 — 7 de octubre de 2026

El usuario pide reducir las modalidades del correo a botones, sin precios ni explicaciones extensas. `buildOnboardingEmail` conserva las instrucciones de documentación y tres enlaces de método, con el plazo tomado del catálogo congelado del expediente. Omite importes, desgloses, ejemplos y prioridades de pago; SMS se resume en una frase. Los detalles económicos siguen en el formulario y contrato.

Los enlaces añaden `posChoice` y el formulario admite únicamente las tres modalidades conocidas. Solo preselecciona si no existe una modalidad guardada y nunca acepta condiciones automáticamente. La elección se confirma al enviar el formulario, no al abrir el enlace.

Comprobado: cinco pruebas de correo y cinco de formulario. Vista móvil de 390 px sin desbordamiento; botones de 59 px de alto. Captura y HTML de datos ficticios en `../../output/onboarding-phase2-2026-10-07/`.

Publicado el 7 de octubre de 2026: backend `e750344` y storefront `fc15c74`, ambos confirmados SUCCESS en Railway. La web pública sirve `main.6f0c3dc8.js` con la nueva modalidad y el ajuste de última cuota. Las notas del correo y del renting se incorporan al feed después de verificar ambos servicios y activar la tarifa.

## Nueva tarifa aprobada e implementada

El usuario aprueba **1 % mensual sobre saldo pendiente**, máximo de 12 cuotas y elección del plazo por el cliente. Confirma la primera cuota después de firmar y antes de activar. Las siguientes vencen cada mes desde la entrega operativa, sin intereses durante la espera anterior a la entrega. Las invitaciones y contratos anteriores conservan sus condiciones congeladas.

El nuevo modo `FINANCED_TERM` genera planes de 1 a 12 cuotas con amortización adelantada, intereses redondeados a céntimos por período y ajuste del saldo en la última cuota. Para 250 € y 12 cuotas: 11 de 21,99 € y una de 22,01 €, total 263,90 €, intereses 13,90 €. Una sola cuota no genera intereses. Formulario, contrato y primer cobro usan el mismo plan del catálogo congelado, sin recalcularlo con tarifas posteriores ni aceptar importes del navegador.

Verificado: 57 pruebas de onboarding, incluidas firma antes del cobro, primer cargo de 21,99 €, activación tras pago e idempotencia, rechazo de alteraciones, cálculo por saldo y compatibilidad con 36 meses anteriores. Diecisiete pruebas de interfaz y compilación completa del storefront correctas. Correo y formulario revisados a 390 px sin desbordamiento; preselección de renting, selector limitado a 12 y resumen de 263,90 € comprobados en navegador con datos ficticios. No se han enviado correos externos ni realizado cobros reales de prueba.

Tarifa de producción activada con `updateOnboardingPricing`, revisión 4 → 5: `FINANCED_TERM`, POS 250 €, hasta 12 cuotas, 1 % mensual, primer pago adelantado. Precio, SMS y resto de condiciones conservados y comprobados. Catálogo de producción leído después del cambio: primera cuota 2.199 céntimos, última 2.201, total 26.390. Sin modificaciones en solicitudes existentes. Avisos de correo y renting (revisión 3) en ES/EN/IT/FR/PT.
