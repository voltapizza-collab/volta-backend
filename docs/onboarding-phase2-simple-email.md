# Revisión de fase 2 — 7 de octubre de 2026

El usuario pide reducir las modalidades del correo a botones, sin precios ni explicaciones extensas. `buildOnboardingEmail` conserva las instrucciones de documentación y tres enlaces de método, con el plazo tomado del catálogo congelado del expediente. Omite importes, desgloses, ejemplos y prioridades de pago; SMS se resume en una frase. Los detalles económicos siguen en el formulario y contrato.

Los enlaces añaden `posChoice` y el formulario admite únicamente las tres modalidades conocidas. Solo preselecciona si no existe una modalidad guardada y nunca acepta condiciones automáticamente. La elección se confirma al enviar el formulario, no al abrir el enlace.

Comprobado: cinco pruebas de correo y cinco de formulario. Vista móvil de 390 px sin desbordamiento; botones de 59 px de alto. Captura y HTML de datos ficticios en `../../output/onboarding-phase2-2026-10-07/`.

Pendiente despliegue coordinado. La nota `onboardingSimpleEmailAnnouncementDraft` queda fuera del feed.

## Nueva tarifa pendiente de concretar

El usuario sustituye la propuesta inicial del 6 % por **1 % mensual**, con máximo de 12 cuotas y elección del plazo por el cliente (conservando lo acordado anteriormente). Se ha explicado como interés sobre saldo pendiente. Se ha preguntado si se mantiene la primera cuota después de firmar y antes de activar —flujo actual— o si comienza al mes; esa respuesta afecta al cálculo y al cierre del alta. Hasta recibirla, no se modifica la tarifa ni los contratos. Las invitaciones y contratos anteriores conservan sus condiciones congeladas.
